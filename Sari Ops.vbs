' Bật máy theo dõi Phòng Vận hành (chạy ẩn).
' Không có tham số: mở luôn trang 3D. Có tham số (vd "nobrowser"): chỉ chạy ngầm.
' Muốn tự bật khi mở máy: chép file này vào thư mục Startup (Win+R, gõ shell:startup).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(dir & "\ops-server.js") Then dir = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\SariOps"
sh.CurrentDirectory = dir
node = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then node = """C:\Program Files\nodejs\node.exe"""
sh.Run "cmd /c " & node & " ops-server.js >> ops-server.log 2>&1", 0, False
WScript.Sleep 4000
If WScript.Arguments.Count = 0 Then sh.Run "http://localhost:8787/#van-hanh"
