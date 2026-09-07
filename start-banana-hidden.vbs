' ============================================================================
'  Banana Clinic Manager - hidden Windows logon launcher
'
'  Starts the local HTTP server with no visible console, then opens
'  http://127.0.0.1:5500/index.html. Intended for the current user's
'  Startup folder (install with install-banana-autostart.bat).
'
'  To troubleshoot, run start-server.bat instead, or read:
'    %TEMP%\banana-autostart.log
' ============================================================================
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1Path = scriptDir & "\start-banana-silent.ps1"
psExe = shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"

If fso.FileExists(ps1Path) Then
    ' 0 = hidden window, False = do not wait (server keeps running after this exits)
    cmd = """" & psExe & """ -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1Path & """"
    shell.Run cmd, 0, False
End If
