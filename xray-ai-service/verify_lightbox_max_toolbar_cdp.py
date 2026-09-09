"""CDP check: maximized X-ray lightbox keeps the full toolbar clickable."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request

import websockets

PORT = 9334
APP = "http://127.0.0.1:5500/index.html?_lr=xraymaxtb3"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(tempfile.gettempdir(), "cs-xray-maxtb-cdp")
FAILS = []
OKS = []


def check(name, cond, detail=""):
    if cond:
        OKS.append(name)
        print("  ok  " + name)
    else:
        FAILS.append(name)
        print("  FAIL " + name + (("  (" + detail + ")") if detail else ""))


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, params=None, timeout=30):
        self.n += 1
        msg_id = self.n
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=max(0.1, deadline - time.time()))
            data = json.loads(raw)
            if data.get("id") == msg_id:
                if "error" in data:
                    raise RuntimeError("%s: %s" % (method, data["error"]))
                return data.get("result") or {}
        raise TimeoutError(method)

    async def js(self, expr, await_promise=False, timeout=45):
        r = await self.call(
            "Runtime.evaluate",
            {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "timeout": int(timeout * 1000),
            },
            timeout=timeout + 5,
        )
        if r.get("exceptionDetails"):
            desc = (r["exceptionDetails"].get("exception") or {}).get("description") or str(
                r["exceptionDetails"]
            )
            raise RuntimeError(desc)
        return (r.get("result") or {}).get("value")


async def wait_js(cdp, expr, timeout=40, interval=0.35):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = await cdp.js(expr, await_promise=True)
        except Exception as exc:
            last = str(exc)
        if last:
            return last
        await asyncio.sleep(interval)
    raise TimeoutError("wait_js: %s last=%r" % (expr[:120], last))


def wait_http(url, timeout=20):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            last = exc
            time.sleep(0.25)
    raise RuntimeError("CDP HTTP not ready: %s (%s)" % (url, last))


async def screenshot(cdp, name):
    os.makedirs(OUT, exist_ok=True)
    r = await cdp.call("Page.captureScreenshot", {"format": "png", "fromSurface": True})
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(__import__("base64").b64decode(r["data"]))
    print("  shot " + path)
    return path


MEASURE_JS = r"""
(function(){
  function rect(el){
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), left: Math.round(r.left),
      display: st.display, visib: st.visibility, z: st.zIndex,
      vis: r.height>8 && r.width>8 && st.display!=='none' && st.visibility!=='hidden'
    };
  }
  var tb = document.querySelector('#xrayLightbox .xray-lb-toolbar');
  var tbr = tb.getBoundingClientRect();
  var groups = [].slice.call(tb.querySelectorAll(':scope > .xray-lb-tgroup'));
  var btns = [].slice.call(tb.querySelectorAll('button'));
  var visBtns = btns.filter(function(b){
    var r = b.getBoundingClientRect();
    var st = getComputedStyle(b);
    return r.height>4 && r.width>4 && st.display!=='none' && st.visibility!=='hidden'
      && r.top >= tbr.top-2 && r.bottom <= tbr.bottom+4;
  });
  var hitBlocked = visBtns.filter(function(b){
    var r = b.getBoundingClientRect();
    var x = r.left + r.width/2;
    var y = r.top + r.height/2;
    var topEl = document.elementFromPoint(x, y);
    return !(topEl && (topEl===b || b.contains(topEl) || (topEl.closest && topEl.closest('.xray-lb-toolbar'))));
  }).map(function(b){ return (b.id || b.getAttribute('title') || 'btn').slice(0,24); });
  var con = document.getElementById('consultationSection');
  return {
    build: window.__JSM_BUILD || '',
    maximized: document.getElementById('xrayLightbox').classList.contains('xray-lb-maximized'),
    bodyMax: document.body.classList.contains('xray-lb-maximized'),
    conZ: con ? getComputedStyle(con).zIndex : '',
    toolbar: rect(tb),
    strip: rect(document.getElementById('appSessionStrip')),
    dock: rect(document.getElementById('activePatientDock')),
    groups: groups.map(function(g){
      var l = g.querySelector('.xray-lb-tglabel');
      return {label: (l && l.textContent || '').trim(), vis: rect(g).vis, top: rect(g).top};
    }),
    btnVisible: visBtns.length,
    hitBlocked: hitBlocked
  };
})()
"""


async def run():
    profile = os.path.join(tempfile.gettempdir(), "cs-xray-maxtb-cdp-profile")
    if os.path.isdir(profile):
        shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile, exist_ok=True)
    args = [
        CHROME,
        "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-popup-blocking",
        "--window-size=1366,768",
        "--disable-gpu",
        APP,
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_http("http://127.0.0.1:%d/json/version" % PORT)
        tabs = wait_http("http://127.0.0.1:%d/json/list" % PORT)
        page = next(
            (t for t in tabs if t.get("type") == "page" and "devtools://" not in (t.get("url") or "")),
            None,
        )
        if not page:
            raise RuntimeError("no page target: %s" % tabs)
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=20 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Page.enable")
            await cdp.call("Runtime.enable")
            await cdp.call("Page.bringToFront")

            print("[1] login")
            await wait_js(cdp, "document.getElementById('loginUserId') ? true : false", 25)
            await wait_js(
                cdp,
                "(function(){var s=document.getElementById('loginClinic');"
                "return s && s.options && s.options.length>1;})()",
                25,
            )
            await cdp.js(
                """
                (function(){
                  document.getElementById('loginUserId').value = 'nurse';
                  document.getElementById('loginPassword').value = 'nurse';
                  var s = document.getElementById('loginClinic');
                  if (s) {
                    for (var i=0;i<s.options.length;i++) {
                      if (s.options[i].value) { s.selectedIndex = i; break; }
                    }
                    s.dispatchEvent(new Event('change', {bubbles:true}));
                  }
                  doLogin();
                  return true;
                })()
                """
            )
            await wait_js(
                cdp,
                """
                (function(){
                  var ov = document.getElementById('loginOverlay');
                  var card = document.getElementById('card-consultation');
                  var vis = ov && (ov.style.display==='none' || ov.hidden ||
                    getComputedStyle(ov).display==='none');
                  return !!(vis && card);
                })()
                """,
                50,
            )
            build = await cdp.js("window.__JSM_BUILD || ''")
            check("BUILD is maxtb3", "maxtb3" in str(build).lower(), str(build))

            print("[2] open real film")
            picked = await cdp.js(
                """
                (async function(){
                  var xr = await SB.from('xrays').select('id,patient_id,xray_type,file_url,taken_date')
                    .not('file_url','is',null).order('taken_date',{ascending:false}).limit(20);
                  var rows = (xr && xr.data) || [];
                  if (!rows.length) return {error:'no xrays'};
                  var p = await SB.from('patients').select('id,full_name,chinese_name,patient_no,clinic_tag,dob,hkid,medical_alerts')
                    .eq('id', rows[0].patient_id).limit(1);
                  if (!p.data || !p.data[0]) return {error:'no patient'};
                  return {patient: p.data[0], film: rows[0]};
                })()
                """,
                await_promise=True,
                timeout=40,
            )
            if not isinstance(picked, dict) or picked.get("error"):
                check("found film", False, str(picked))
                return
            check("found film", True, str((picked.get("patient") or {}).get("full_name")))
            await cdp.js("initConsultation(); true;")
            await asyncio.sleep(0.5)
            await cdp.js(
                "selectConPatient(%s); switchConTab('xray'); true;" % json.dumps(picked["patient"])
            )
            await wait_js(
                cdp,
                "typeof xrayFiltered!=='undefined' && xrayFiltered && xrayFiltered.length>0",
                25,
            )
            await cdp.js("openLightbox(0); true;")
            await wait_js(
                cdp,
                """
                (function(){
                  var m=document.getElementById('xrayLightbox');
                  var img=document.getElementById('xrayLbImg');
                  return !!(m && m.style.display==='block' && img && img.naturalWidth>0);
                })()
                """,
                30,
            )
            await screenshot(cdp, "01-windowed.png")
            win = await cdp.js(MEASURE_JS)
            win_labels = [g.get("label") for g in (win or {}).get("groups") or [] if g.get("vis")]
            check("windowed toolbar has View+Draw+Edit", all(x in win_labels for x in ["View", "Draw", "Edit"]), str(win_labels))
            check("windowed not maximized", not (win or {}).get("maximized"))

            print("[3] maximize / fit-to-page")
            await cdp.js("lbToggleMaximize(); true;")
            await asyncio.sleep(0.4)
            info = await cdp.js(MEASURE_JS)
            await screenshot(cdp, "02-maximized.png")
            labels = [g.get("label") for g in (info or {}).get("groups") or [] if g.get("vis")]
            blocked = (info or {}).get("hitBlocked") or []
            check("maximized class on", bool(info and info.get("maximized")))
            check("consultation z-index raised", str((info or {}).get("conZ")) == "20000", str((info or {}).get("conZ")))
            check("session strip hidden", not ((info or {}).get("strip") or {}).get("vis"), str((info or {}).get("strip")))
            check("patient dock hidden", not ((info or {}).get("dock") or {}).get("vis"), str((info or {}).get("dock")))
            needed = ["View", "Transform", "Adjust", "Assist", "Draw", "Edit"]
            missing = [n for n in needed if n not in labels]
            check("all usable toolbar groups visible", not missing, "visible=%s missing=%s" % (labels, missing))
            check("toolbar buttons not covered", len(blocked) == 0, str(blocked))
            check("at least 20 toolbar buttons clickable", int((info or {}).get("btnVisible") or 0) >= 20, str((info or {}).get("btnVisible")))
            check("View group present", "View" in labels, str(labels))
            check("Assist group present", "Assist" in labels, str(labels))

            ids = await cdp.js(
                """
                (function(){
                  function hit(id){
                    var b=document.getElementById(id);
                    if(!b) return {id:id, missing:true};
                    var r=b.getBoundingClientRect();
                    var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
                    return {
                      id:id, w:Math.round(r.width), h:Math.round(r.height),
                      top:Math.round(r.top),
                      hit: !!(el && (el===b || b.contains(el) || (el.closest && el.closest('.xray-lb-toolbar'))))
                    };
                  }
                  return ['lbLoupeBtn','lbXrayAiBtn','lbTBtn-free','lbToggleMaxBtn','lbPrevBtn'].map(hit);
                })()
                """
            )
            for row in ids or []:
                check(
                    "spot hit " + str(row.get("id")),
                    bool(row.get("hit")) and int(row.get("h") or 0) > 8,
                    str(row),
                )

            print("[4] tools still work while maxed")
            scale0 = await cdp.js("(window.lbTransform && lbTransform.scale) || 0")
            await cdp.js("lbZoom(1.25); true;")
            await asyncio.sleep(0.15)
            scale1 = await cdp.js("(window.lbTransform && lbTransform.scale) || 0")
            check("zoom in while maximized", float(scale1 or 0) > float(scale0 or 0), "%s -> %s" % (scale0, scale1))

            await cdp.js("document.getElementById('lbLoupeBtn').click(); true;")
            loupe = await cdp.js(
                """
                (function(){
                  var el=document.getElementById('xrayLbLoupe');
                  return {
                    active: !!window.lbLoupeActive,
                    hidden: !!(el && el.hidden),
                    badge: ((el && el.querySelector('.xray-lb-loupe-badge'))||{}).textContent||''
                  };
                })()
                """
            )
            check("loupe toggles while maximized", bool((loupe or {}).get("active")) and not (loupe or {}).get("hidden"), str(loupe))
            check("loupe badge is 3x", "3" in str((loupe or {}).get("badge") or ""), str(loupe))
            await screenshot(cdp, "03-max-loupe.png")
            await cdp.js("document.getElementById('lbLoupeBtn').click(); true;")
            await cdp.js("document.getElementById('lbTBtn-free').click(); true;")
            tool = await cdp.js("window.lbTool")
            check("draw tool still selectable", tool == "free", str(tool))
            await cdp.js("lbSetTool('pan'); true;")

            print("[5] restore window size")
            await cdp.js("lbToggleMaximize(); true;")
            await asyncio.sleep(0.25)
            restored = await cdp.js(MEASURE_JS)
            check(
                "restore window size works",
                not (restored or {}).get("maximized"),
                str((restored or {}).get("maximized")),
            )
            check("session strip back after restore", bool(((restored or {}).get("strip") or {}).get("vis")))
            rest_labels = [g.get("label") for g in (restored or {}).get("groups") or [] if g.get("vis")]
            check("toolbar still complete after restore", "View" in rest_labels and "Draw" in rest_labels, str(rest_labels))
            await screenshot(cdp, "04-restored.png")

            print("[6] close clears maximize chrome")
            await cdp.js("typeof _forceCloseLightbox==='function' ? (_forceCloseLightbox(), true) : (closeLightbox(), true);")
            await asyncio.sleep(0.2)
            closed = await cdp.js(
                """
                (function(){
                  var m=document.getElementById('xrayLightbox');
                  return {
                    display: m && m.style.display,
                    maxClass: !!(m && m.classList.contains('xray-lb-maximized')),
                    bodyMax: document.body.classList.contains('xray-lb-maximized')
                  };
                })()
                """
            )
            check("lightbox closed", (closed or {}).get("display") in ("none", "", None) or (closed or {}).get("display") != "block", str(closed))
            check("body maximize class cleared", not (closed or {}).get("bodyMax"), str(closed))

            print("[7] photo lightbox maximize")
            photo_pick = await cdp.js(
                """
                (async function(){
                  var ph = await SB.from('photos').select('id,patient_id,file_path,file_url')
                    .not('file_url','is',null).order('taken_date',{ascending:false}).limit(15);
                  var rows = (ph && ph.data) || [];
                  rows = rows.filter(function(r){ return !(r.file_path||'').toLowerCase().endsWith('.pdf'); });
                  if (!rows.length) return {error:'no photos'};
                  var p = await SB.from('patients').select('id,full_name,chinese_name,patient_no,clinic_tag,dob,hkid,medical_alerts')
                    .eq('id', rows[0].patient_id).limit(1);
                  if (!p.data || !p.data[0]) return {error:'no photo patient'};
                  return {patient: p.data[0], n: rows.length};
                })()
                """,
                await_promise=True,
                timeout=30,
            )
            if not isinstance(photo_pick, dict) or photo_pick.get("error"):
                check("photo lightbox skipped (no photos)", True, str(photo_pick))
            else:
                await cdp.js("initConsultation(); true;")
                await asyncio.sleep(0.3)
                await cdp.js(
                    "selectConPatient(%s); switchConTab('photos'); true;"
                    % json.dumps(photo_pick["patient"])
                )
                await wait_js(
                    cdp,
                    "typeof photoFiltered!=='undefined' && photoFiltered && photoFiltered.length>0",
                    25,
                )
                await cdp.js("openPhotoLightbox(0); true;")
                await wait_js(
                    cdp,
                    """
                    (function(){
                      var m=document.getElementById('photoLightbox');
                      return !!(m && m.style.display==='block');
                    })()
                    """,
                    20,
                )
                await cdp.js("photoLbToggleMaximize(); true;")
                await asyncio.sleep(0.35)
                ph = await cdp.js(
                    """
                    (function(){
                      var m=document.getElementById('photoLightbox');
                      var tb=m && m.querySelector('.xray-lb-toolbar');
                      var groups=tb ? [].slice.call(tb.querySelectorAll('.xray-lb-tgroup')) : [];
                      var vis=groups.filter(function(g){
                        var r=g.getBoundingClientRect();
                        return r.height>8 && getComputedStyle(g).display!=='none';
                      }).length;
                      var con=document.getElementById('consultationSection');
                      return {
                        max: m.classList.contains('xray-lb-maximized'),
                        conZ: con ? getComputedStyle(con).zIndex : '',
                        visGroups: vis,
                        stripHidden: getComputedStyle(document.getElementById('appSessionStrip')).visibility==='hidden'
                      };
                    })()
                    """
                )
                await screenshot(cdp, "05-photo-maximized.png")
                check("photo maximize class on", bool((ph or {}).get("max")), str(ph))
                check("photo maximize raises consultation z", str((ph or {}).get("conZ")) == "20000", str(ph))
                check("photo toolbar groups remain", int((ph or {}).get("visGroups") or 0) >= 3, str(ph))
                check("photo max hides session strip", bool((ph or {}).get("stripHidden")), str(ph))
                await cdp.js("photoLbToggleMaximize(); true;")
                await cdp.js("typeof closePhotoLightbox==='function' && (closePhotoLightbox(), true);")
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=4)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


if __name__ == "__main__":
    print("CDP maximize-toolbar test")
    print("  shots ->", OUT)
    asyncio.run(run())
    print()
    print("%d ok, %d fail" % (len(OKS), len(FAILS)))
    if FAILS:
        raise SystemExit(1)
    print("All checks passed.")
