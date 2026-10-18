# Writes patient name into Carestream Patient.exe live-filter Edit control.
# Invoked hidden by xray-local-launcher.ps1 after /open/carestream launch.
# Prefer -SearchFile (UTF-8) so spaces / Chinese names survive Start-Process.
param(
    [string]$SearchText = "",
    [string]$SearchFile = ""
)

if (-not [string]::IsNullOrWhiteSpace($SearchFile) -and (Test-Path -LiteralPath $SearchFile)) {
    try {
        $SearchText = [IO.File]::ReadAllText($SearchFile, (New-Object System.Text.UTF8Encoding $false)).Trim()
    } catch {
        $SearchText = ""
    }
    try { Remove-Item -LiteralPath $SearchFile -Force -ErrorAction SilentlyContinue } catch {}
}

if ([string]::IsNullOrWhiteSpace($SearchText)) { exit 0 }

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CsPatWin {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
    [DllImport("user32.dll")] public static extern int SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public const uint EM_SETSEL = 0x00B1;
    public const uint EM_REPLACESEL = 0x00C2;
    public const uint WM_SETTEXT = 0x000C;
    public const uint WM_COMMAND = 0x0111;
    public const int EN_CHANGE = 0x0300;
    public static IntPtr FindLiveFilterEdit(IntPtr main) {
        IntPtr best = IntPtr.Zero;
        int bestY = int.MaxValue;
        int bestW = -1;
        EnumChildWindows(main, (h, l) => {
            var cls = new StringBuilder(64);
            GetClassName(h, cls, 64);
            if (!cls.ToString().Equals("Edit", StringComparison.OrdinalIgnoreCase)) return true;
            if (!IsWindowVisible(h)) return true;
            RECT r;
            if (!GetWindowRect(h, out r)) return true;
            int w = r.Right - r.Left;
            int ht = r.Bottom - r.Top;
            if (ht < 14 || ht > 40 || w < 60) return true;
            if (r.Top < bestY || (r.Top == bestY && w > bestW)) {
                best = h; bestY = r.Top; bestW = w;
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
    public static void FocusMain(IntPtr hwnd) {
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9); else ShowWindow(hwnd, 5);
        ShowWindow(hwnd, 9);
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
        SetActiveWindow(hwnd);
        if (fgTid != curTid) AttachThreadInput(curTid, fgTid, false);
        if (winTid != curTid && winTid != fgTid) AttachThreadInput(curTid, winTid, false);
    }
    public static bool SetEditLiveFilter(IntPtr main, IntPtr edit, string text) {
        FocusMain(main);
        SetFocus(edit);
        SendMessage(edit, EM_SETSEL, (IntPtr)0, (IntPtr)(-1));
        int replaced = SendMessage(edit, EM_REPLACESEL, (IntPtr)1, text);
        IntPtr parent = GetParent(edit);
        int id = GetDlgCtrlID(edit);
        if (parent != IntPtr.Zero) {
            IntPtr wParam = (IntPtr)((EN_CHANGE << 16) | (id & 0xFFFF));
            SendMessage(parent, WM_COMMAND, wParam, edit);
        }
        if (replaced == 0) {
            SendMessage(edit, WM_SETTEXT, IntPtr.Zero, text);
            if (parent != IntPtr.Zero) {
                IntPtr wParam = (IntPtr)((EN_CHANGE << 16) | (id & 0xFFFF));
                SendMessage(parent, WM_COMMAND, wParam, edit);
            }
        }
        return true;
    }
}
"@

$deadline = (Get-Date).AddSeconds(25)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
    $p = Get-Process -Name "Patient" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
        Select-Object -First 1
    if ($p) { $hwnd = $p.MainWindowHandle; break }
    Start-Sleep -Milliseconds 300
}
if ($hwnd -eq [IntPtr]::Zero) { exit 0 }

$edit = [IntPtr]::Zero
$editDeadline = (Get-Date).AddSeconds(12)
while ((Get-Date) -lt $editDeadline) {
    $edit = [CsPatWin]::FindLiveFilterEdit($hwnd)
    if ($edit -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
}

try {
    if ($edit -ne [IntPtr]::Zero) {
        [CsPatWin]::SetEditLiveFilter($hwnd, $edit, $SearchText) | Out-Null
    } else {
        [CsPatWin]::FocusMain($hwnd)
        Start-Sleep -Milliseconds 500
        Set-Clipboard -Value $SearchText
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait("^v")
    }
} catch {}
