"""
CDP smoke + spot test: X-ray lightbox 3x loupe on a real patient film.

Requires Chrome, live-server on :5500, and network to Supabase (anon).
Run:  python verify_lightbox_loupe_cdp.py
"""
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

PORT = 9333
APP = "http://127.0.0.1:5500/index.html?_lr=xraymaxtb3"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(tempfile.gettempdir(), "cs-xray-loupe-cdp")
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
        val = (r.get("result") or {}).get("value")
        return val


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


async def mouse(cdp, typ, x, y, button="none"):
    params = {
        "type": typ,
        "x": float(x),
        "y": float(y),
        "button": button,
        "buttons": 2 if (typ != "mouseReleased" and button == "right") else (1 if button == "left" else 0),
        "clickCount": 1 if typ in ("mousePressed", "mouseReleased") else 0,
    }
    if button == "right" and typ == "mousePressed":
        params["buttons"] = 2
    await cdp.call("Input.dispatchMouseEvent", params)


async def run():
    profile = os.path.join(tempfile.gettempdir(), "cs-xray-cdp-profile")
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
        "--window-size=1500,950",
        "--disable-gpu",
        APP,
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ver = wait_http("http://127.0.0.1:%d/json/version" % PORT)
        tabs = wait_http("http://127.0.0.1:%d/json/list" % PORT)
        page = next(
            (t for t in tabs if t.get("type") == "page" and "devtools://" not in (t.get("url") or "")),
            None,
        )
        if not page:
            raise RuntimeError("no page target: %s / %s" % (ver, tabs))
        ws_url = page["webSocketDebuggerUrl"]
        print("  page", page.get("url"), "->", ws_url[:60])
        async with websockets.connect(ws_url, max_size=20 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Page.enable")
            await cdp.call("Runtime.enable")
            await cdp.call("Page.bringToFront")

            print("[1] login")
            await wait_js(cdp, "document.getElementById('loginUserId') ? true : false", 25)
            # Clinic options populate async.
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
            check("app BUILD loaded", bool(build), str(build))
            check("logged in (login overlay gone)", True)

            print("[2] pick real PA/bitewing patient")
            picked = await cdp.js(
                """
                (async function(){
                  var xr = await SB.from('xrays')
                    .select('id,patient_id,xray_type,file_url,taken_date')
                    .in('xray_type', ['Bitewing','Periapical','bitewing','periapical'])
                    .not('file_url','is',null)
                    .order('taken_date', {ascending:false})
                    .limit(40);
                  if (xr.error) return {error: xr.error.message || String(xr.error)};
                  var rows = xr.data || [];
                  if (!rows.length) {
                    var any = await SB.from('xrays').select('id,patient_id,xray_type,file_url,taken_date')
                      .not('file_url','is',null).order('taken_date',{ascending:false}).limit(20);
                    rows = any.data || [];
                  }
                  if (!rows.length) return {error:'no xrays'};
                  var pid = rows[0].patient_id;
                  var p = await SB.from('patients').select('id,full_name,chinese_name,patient_no,clinic_tag,dob,hkid,medical_alerts')
                    .eq('id', pid).limit(1);
                  if (p.error || !p.data || !p.data[0]) return {error:'no patient for '+pid};
                  return {patient: p.data[0], film: rows[0], n: rows.length};
                })()
                """,
                await_promise=True,
                timeout=40,
            )
            if not isinstance(picked, dict) or picked.get("error"):
                check("found real patient with film", False, str(picked))
                await screenshot(cdp, "fail-no-patient.png")
                return
            pname = (picked["patient"].get("full_name") or "") + " " + (picked["patient"].get("patient_no") or "")
            ftype = picked["film"].get("xray_type")
            check("found real patient with film", True, pname.strip() + " / " + str(ftype))
            print("      patient:", pname.strip(), "| type:", ftype)

            await cdp.js("initConsultation(); true;")
            await asyncio.sleep(0.6)
            await cdp.js(
                "selectConPatient(%s); switchConTab('xray'); true;"
                % json.dumps(picked["patient"])
            )
            await wait_js(
                cdp,
                "typeof xrayFiltered!=='undefined' && xrayFiltered && xrayFiltered.length>0",
                25,
            )
            nfilms = await cdp.js("(xrayFiltered||[]).length")
            check("xray tab loaded films", int(nfilms or 0) >= 1, str(nfilms))

            print("[3] lightbox + loupe toolbar")
            await cdp.js("openLightbox(0); true;")
            await wait_js(
                cdp,
                """
                (function(){
                  var m=document.getElementById('xrayLightbox');
                  var img=document.getElementById('xrayLbImg');
                  return !!(m && m.style.display==='block' && img && img.complete && img.naturalWidth>0);
                })()
                """,
                30,
            )
            btn = await cdp.js(
                """
                (function(){
                  var b=document.getElementById('lbLoupeBtn');
                  return b ? {id:b.id, title:b.getAttribute('title')||'', text:b.textContent} : null;
                })()
                """
            )
            check("magnifier button present", bool(btn and btn.get("id")=="lbLoupeBtn"), str(btn))
            loupe_el = await cdp.js(
                """
                (function(){
                  var el=document.getElementById('xrayLbLoupe');
                  var cv=document.getElementById('xrayLbLoupeCanvas');
                  return el && cv ? {hidden: !!el.hidden, w: cv.width, h: cv.height} : null;
                })()
                """
            )
            check("loupe overlay exists and starts hidden", bool(loupe_el) and loupe_el.get("hidden") is True, str(loupe_el))
            await screenshot(cdp, "01-lightbox.png")

            print("[4] 3x loupe follows cursor (CDP mouse)")
            box = await cdp.js(
                """
                (function(){
                  var img=document.getElementById('xrayLbImg');
                  var r=img.getBoundingClientRect();
                  return {x: r.left+r.width*0.42, y: r.top+r.height*0.45, w:r.width, h:r.height};
                })()
                """
            )
            check("film has on-screen box", box and box.get("w", 0) > 40, str(box))
            await cdp.js(
                "lbToggleLoupe({clientX:%s, clientY:%s}); true;"
                % (box["x"], box["y"])
            )
            on = await cdp.js(
                """
                (function(){
                  var el=document.getElementById('xrayLbLoupe');
                  return {
                    active: !!window.lbLoupeActive,
                    hidden: !!(el && el.hidden),
                    badge: (el && el.querySelector('.xray-lb-loupe-badge')||{}).textContent||'',
                    btnOn: document.getElementById('lbLoupeBtn').classList.contains('lb-tool-active')
                  };
                })()
                """
            )
            check("loupe activates", on and on.get("active") and not on.get("hidden"), str(on))
            check("badge is 3x", "3" in str((on or {}).get("badge") or ""), str(on))

            # Move across the film so the ring tracks and canvas samples.
            x0, y0 = float(box["x"]), float(box["y"])
            for i in range(8):
                await mouse(cdp, "mouseMoved", x0 + i * 18, y0 + i * 8)
                await asyncio.sleep(0.05)
            pix = await cdp.js(
                """
                (function(){
                  var cv=document.getElementById('xrayLbLoupeCanvas');
                  var ctx=cv.getContext('2d');
                  var d=ctx.getImageData(cv.width/2, cv.height/2, 1, 1).data;
                  var all=ctx.getImageData(0,0,cv.width,cv.height).data;
                  var sum=0, n=0;
                  for (var i=0;i<all.length;i+=16){ sum+=all[i]+all[i+1]+all[i+2]; n++; }
                  return {cx:[d[0],d[1],d[2],d[3]], mean: sum/n, active: !!lbLoupeActive};
                })()
                """
            )
            mean = (pix or {}).get("mean") or 0
            check("loupe canvas sampled film pixels", mean > 8, str(pix))
            drag_blocked = await cdp.js(
                "!!(lbLoupeActive && !lbScrollShouldHandleDrag({button:0, target:{id:'x'}}))"
            )
            check("drag is blocked while loupe is on", bool(drag_blocked), str(drag_blocked))
            await screenshot(cdp, "02-loupe-on.png")

            print("[5] right-click cancels and resumes drag")
            # Fire the same contextmenu path the UI uses, plus a CDP right-click.
            await cdp.js(
                """
                (function(){
                  var ev = new MouseEvent('contextmenu', {bubbles:true, cancelable:true, button:2, clientX:%s, clientY:%s});
                  document.dispatchEvent(ev);
                  return true;
                })()
                """
                % (x0, y0)
            )
            await mouse(cdp, "mouseMoved", x0, y0)
            await mouse(cdp, "mousePressed", x0, y0, "right")
            await mouse(cdp, "mouseReleased", x0, y0, "right")
            await asyncio.sleep(0.2)
            after = await cdp.js(
                """
                (function(){
                  var el=document.getElementById('xrayLbLoupe');
                  return {
                    active: !!window.lbLoupeActive,
                    hidden: !!(el && el.hidden),
                    tool: window.lbTool,
                    btnOn: document.getElementById('lbLoupeBtn').classList.contains('lb-tool-active')
                  };
                })()
                """
            )
            check("loupe off after right-click", after and after.get("active") is False and after.get("hidden") is True, str(after))
            check("tool resumes pan/drag", after and after.get("tool") == "pan", str(after))
            await screenshot(cdp, "03-after-right-click.png")

            print("[6] toggle off via button also resumes drag")
            await cdp.js("lbToggleLoupe({clientX:%s, clientY:%s}); true;" % (x0, y0))
            await asyncio.sleep(0.1)
            mid = await cdp.js("!!lbLoupeActive")
            await cdp.js("lbToggleLoupe({clientX:%s, clientY:%s}); true;" % (x0, y0))
            end = await cdp.js("({active:!!lbLoupeActive, tool:lbTool})")
            check("button re-enables loupe", bool(mid), str(mid))
            check("button off resumes pan", end and end.get("active") is False and end.get("tool")=="pan", str(end))

            edj = await cdp.js(
                """
                (function(){
                  if (typeof xrayAiState === 'undefined') return false;
                  return (xrayAiState.anatomyLayers || []).some(function(L){ return L.layer==='edj'; });
                })()
                """
            )
            check("EDJ line is not drawn as an anatomy overlay", edj is False or edj is None, str(edj))

            await screenshot(cdp, "04-done.png")
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
    print("CDP loupe smoke/spot test")
    print("  shots ->", OUT)
    asyncio.run(run())
    print()
    print("%d ok, %d fail" % (len(OKS), len(FAILS)))
    if FAILS:
        raise SystemExit(1)
    print("All checks passed.")
