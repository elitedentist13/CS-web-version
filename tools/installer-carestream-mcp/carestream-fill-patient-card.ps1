# Prefill Carestream "Patient Card" (Create patient) for a new chart.
# Invoked hidden by xray-local-launcher.ps1. Does NOT click Create — staff confirms.
param(
    [string]$DataFile = ""
)

if ([string]::IsNullOrWhiteSpace($DataFile) -or -not (Test-Path -LiteralPath $DataFile)) { exit 0 }

try {
    $raw = [IO.File]::ReadAllText($DataFile, (New-Object System.Text.UTF8Encoding $false))
} catch {
    exit 0
}
try { Remove-Item -LiteralPath $DataFile -Force -ErrorAction SilentlyContinue } catch {}

$data = $null
try { $data = $raw | ConvertFrom-Json } catch { exit 0 }
if (-not $data) { exit 0 }

$first = [string]$data.first
$last = [string]$data.last
$day = [string]$data.day
$month = [string]$data.month
$year = [string]$data.year
$chart = [string]$data.chart
$hkid = [string]$data.hkid
$sex = [string]$data.sex

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CsCard {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll")] public static extern int SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public const uint EM_SETSEL = 0x00B1;
    public const uint EM_REPLACESEL = 0x00C2;
    public const uint WM_SETTEXT = 0x000C;
    public const uint WM_GETTEXT = 0x000D;
    public const uint CB_SETCURSEL = 0x014E;
    public const uint CB_SELECTSTRING = 0x014D;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public static IntPtr FindMainWindow() {
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("Patient")) {
            if (p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle;
        }
        return IntPtr.Zero;
    }

    public static IntPtr FindPatientCardDialog() {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint pid = 0;
            GetWindowThreadProcessId(h, out pid);
            try {
                var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                if (!string.Equals(proc.ProcessName, "Patient", StringComparison.OrdinalIgnoreCase)) return true;
            } catch { return true; }
            if (!IsWindowVisible(h)) return true;
            var cls = new StringBuilder(64);
            GetClassName(h, cls, 64);
            var title = new StringBuilder(256);
            GetWindowText(h, title, 256);
            if (cls.ToString() == "#32770" && title.ToString().IndexOf("Patient Card", StringComparison.OrdinalIgnoreCase) >= 0) {
                found = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void FocusWindow(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return;
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9); else ShowWindow(hwnd, 5);
        var fg = GetForegroundWindow();
        uint dummy = 0;
        uint fgTid = GetWindowThreadProcessId(fg, out dummy);
        uint curTid = GetCurrentThreadId();
        uint winTid = GetWindowThreadProcessId(hwnd, out dummy);
        if (fgTid != curTid) AttachThreadInput(curTid, fgTid, true);
        if (winTid != curTid && winTid != fgTid) AttachThreadInput(curTid, winTid, true);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if (fgTid != curTid) AttachThreadInput(curTid, fgTid, false);
        if (winTid != curTid && winTid != fgTid) AttachThreadInput(curTid, winTid, false);
    }

    public static bool ClickChildByTitle(IntPtr root, string title) {
        IntPtr target = IntPtr.Zero;
        EnumChildWindows(root, (h, l) => {
            var t = new StringBuilder(256);
            GetWindowText(h, t, 256);
            if (string.Equals(t.ToString(), title, StringComparison.OrdinalIgnoreCase) && IsWindowVisible(h)) {
                target = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        if (target == IntPtr.Zero) {
            // also search top-level Patient windows' children (button on main UI)
            EnumWindows((h, l) => {
                uint pid = 0;
                GetWindowThreadProcessId(h, out pid);
                try {
                    var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                    if (!string.Equals(proc.ProcessName, "Patient", StringComparison.OrdinalIgnoreCase)) return true;
                } catch { return true; }
                EnumChildWindows(h, (ch, l2) => {
                    var t = new StringBuilder(256);
                    GetWindowText(ch, t, 256);
                    if (string.Equals(t.ToString(), title, StringComparison.OrdinalIgnoreCase) && IsWindowVisible(ch)) {
                        target = ch;
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);
                return target == IntPtr.Zero;
            }, IntPtr.Zero);
        }
        if (target == IntPtr.Zero) return false;
        RECT r;
        if (!GetWindowRect(target, out r)) return false;
        int x = r.Left + Math.Max(8, (r.Right - r.Left) / 2);
        int y = r.Top + Math.Max(8, (r.Bottom - r.Top) / 2);
        FocusWindow(root != IntPtr.Zero ? root : target);
        SetCursorPos(x, y);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        return true;
    }

    public static void SetEdit(IntPtr edit, string text) {
        if (edit == IntPtr.Zero || text == null) return;
        ShowWindow(edit, 5);
        SetFocus(edit);
        SendMessage(edit, EM_SETSEL, (IntPtr)0, (IntPtr)(-1));
        SendMessage(edit, EM_REPLACESEL, (IntPtr)1, text);
        SendMessage(edit, WM_SETTEXT, IntPtr.Zero, text);
    }

    public static string GetEdit(IntPtr edit) {
        var sb = new StringBuilder(256);
        SendMessage(edit, WM_GETTEXT, (IntPtr)sb.Capacity, sb);
        return sb.ToString();
    }

    public static Dictionary<string, IntPtr> MapLabeledFields(IntPtr dlg) {
        var map = new Dictionary<string, IntPtr>(StringComparer.OrdinalIgnoreCase);
        string pending = null;
        EnumChildWindows(dlg, (h, l) => {
            var cls = new StringBuilder(64);
            GetClassName(h, cls, 64);
            var title = new StringBuilder(256);
            GetWindowText(h, title, 256);
            string c = cls.ToString();
            string t = title.ToString();
            if (c == "Static" && t.Length > 0) {
                pending = t.Replace("*", "").Trim();
            } else if ((c == "Edit" || c == "ComboBox") && pending != null) {
                if (!map.ContainsKey(pending)) map[pending] = h;
                pending = null;
            }
            return true;
        }, IntPtr.Zero);
        return map;
    }

    public static IntPtr[] FindDobEdits(IntPtr dlg) {
        var list = new List<IntPtr>();
        var metas = new List<KeyValuePair<int, IntPtr>>();
        EnumChildWindows(dlg, (h, l) => {
            var cls = new StringBuilder(32);
            GetClassName(h, cls, 32);
            if (cls.ToString() != "Edit" || !IsWindowVisible(h)) return true;
            RECT r;
            if (!GetWindowRect(h, out r)) return true;
            int w = r.Right - r.Left;
            int ht = r.Bottom - r.Top;
            // Day/Month/Year are the three short edits on the DOB row.
            if (w >= 60 && w <= 110 && ht >= 16 && ht <= 26) {
                string txt = GetEdit(h);
                if (txt == "Day" || txt == "Month" || txt == "Year" ||
                    System.Text.RegularExpressions.Regex.IsMatch(txt ?? "", @"^\d{1,4}$") ||
                    string.IsNullOrEmpty(txt)) {
                    metas.Add(new KeyValuePair<int, IntPtr>(r.Left, h));
                }
            }
            return true;
        }, IntPtr.Zero);
        metas.Sort((a, b) => a.Key.CompareTo(b.Key));
        // Prefer the rightmost trio on the DOB row (largest X cluster).
        if (metas.Count >= 3) {
            // Take last 3 if more than 3 tiny edits matched.
            int start = Math.Max(0, metas.Count - 3);
            for (int i = start; i < metas.Count; i++) list.Add(metas[i].Value);
        }
        return list.ToArray();
    }

    public static void SetGender(IntPtr combo, string sex) {
        if (combo == IntPtr.Zero) return;
        bool male = !string.IsNullOrEmpty(sex) &&
            sex.StartsWith("M", StringComparison.OrdinalIgnoreCase);
        int idx = male ? 1 : 0;
        string label = male ? "Male" : "Female";
        SendMessage(combo, CB_SETCURSEL, (IntPtr)idx, IntPtr.Zero);
        SendMessage(combo, CB_SELECTSTRING, (IntPtr)(-1), label);
    }
}
"@

$deadline = (Get-Date).AddSeconds(25)
$main = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
    $main = [CsCard]::FindMainWindow()
    if ($main -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 300
}
if ($main -eq [IntPtr]::Zero) { exit 0 }

[CsCard]::FocusWindow($main)
Start-Sleep -Milliseconds 600

# Open Create patient if Patient Card is not already up.
$dlg = [CsCard]::FindPatientCardDialog()
if ($dlg -eq [IntPtr]::Zero) {
    [CsCard]::ClickChildByTitle($main, "Create patient") | Out-Null
    $openDeadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $openDeadline) {
        $dlg = [CsCard]::FindPatientCardDialog()
        if ($dlg -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 250
    }
}
if ($dlg -eq [IntPtr]::Zero) { exit 0 }

[CsCard]::FocusWindow($dlg)
Start-Sleep -Milliseconds 400

$map = [CsCard]::MapLabeledFields($dlg)
if ($map.ContainsKey("First name") -and $first) { [CsCard]::SetEdit($map["First name"], $first) }
if ($map.ContainsKey("Last name") -and $last) { [CsCard]::SetEdit($map["Last name"], $last) }
if ($map.ContainsKey("SSN") -and $hkid) { [CsCard]::SetEdit($map["SSN"], $hkid) }
if ($map.ContainsKey("Patient identifier") -and $chart) { [CsCard]::SetEdit($map["Patient identifier"], $chart) }
if ($map.ContainsKey("Gender") -and $sex) { [CsCard]::SetGender($map["Gender"], $sex) }

$dobEdits = [CsCard]::FindDobEdits($dlg)
if ($dobEdits.Length -ge 3) {
    if ($day) { [CsCard]::SetEdit($dobEdits[0], $day) }
    if ($month) { [CsCard]::SetEdit($dobEdits[1], $month) }
    if ($year) { [CsCard]::SetEdit($dobEdits[2], $year) }
}
