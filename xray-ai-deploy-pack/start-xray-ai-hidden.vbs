' ============================================================================
'  CS X-ray Assist - hidden autostart launcher
'
'  Runs start-xray-ai.bat with no visible console window, so the local AI
'  service is already listening on http://127.0.0.1:8765 by the time anyone
'  presses "X-ray Assist" in the app. Intended to be triggered by the
'  "CS X-ray AI Autostart" Task Scheduler task (fires at user logon).
'
'  To troubleshoot the service (see install/model-download progress, or read
'  error messages), double-click start-xray-ai.bat directly instead - this
'  wrapper intentionally hides all of that output.
' ============================================================================
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\start-xray-ai.bat"

If fso.FileExists(batPath) Then
    ' 0 = hidden window, False = do not wait (the service runs indefinitely)
    shell.Run """" & batPath & """", 0, False
End If
