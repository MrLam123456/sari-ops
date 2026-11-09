# Sari Ops

Máy theo dõi cho **Phòng Vận hành 3D** của Sari. Nó chỉ **đọc** trạng thái tool: tiến trình đang chạy, Task Scheduler và file log. Nó không bật, không tắt và không sửa tool nào.

## Cài lên một PC (PC 2, PC 3…)

Mở **PowerShell** rồi dán:

```powershell
irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/install.ps1 | iex
```

Muốn đặt tên máy, thêm phần này vào trước câu lệnh:

```powershell
$env:SARI_MAY='PC 3'; irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/install.ps1 | iex
```

Script tự làm các việc sau:

1. Cài Node.js và Tailscale nếu máy chưa có.
2. Chép máy theo dõi vào `%USERPROFILE%\SariOps`.
3. Cho nó tự bật cùng Windows.
4. Mở cổng 8787, chỉ cho mạng Tailscale.
5. Bật máy theo dõi.

Đăng nhập Tailscale bằng **cùng tài khoản** với PC chính. Trong khoảng 1 phút, PC chính sẽ tự tìm thấy máy mới.

## Bộ tool theo máy

`profiles/<tên>.json` liệt kê các tool mà máy đó chạy. Mặc định là `pc2`. Muốn chọn bộ khác thì đặt `$env:SARI_PROFILE='<tên>'` trước câu lệnh cài. Sau khi cài, sửa file `%USERPROFILE%\SariOps\tools.json` trên từng máy cũng được.
