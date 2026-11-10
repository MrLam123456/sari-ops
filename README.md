# Sari Ops

Máy theo dõi cho **Phòng Vận hành 3D** của Sari. Nó chỉ **đọc** trạng thái tool: tiến trình đang chạy, Task Scheduler và file log. Nó không bật, không tắt và không sửa tool nào.

## Cài lên một PC (PC 2, PC 3, Laptop…)

Mở **PowerShell** rồi dán:

```powershell
irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/install.ps1 | iex
```

Muốn đặt tên máy, thêm phần này vào trước câu lệnh:

```powershell
$env:SARI_MAY='PC 2'; irm https://raw.githubusercontent.com/MrLam123456/sari-ops/main/install.ps1 | iex
```

Script tự làm các việc sau:

1. Cài Node.js và Tailscale nếu máy chưa có.
2. Chép máy theo dõi vào `%USERPROFILE%\SariOps`.
3. Cho nó tự bật cùng Windows.
4. Mở cổng 8787, chỉ cho mạng Tailscale.
5. Bật máy theo dõi.

Đăng nhập Tailscale bằng **cùng tài khoản** với PC 1 (máy chính). Trong khoảng 1 phút, PC 1 sẽ tự tìm thấy máy mới.

## Bộ tool theo máy

`profiles/<tên>.json` liệt kê các tool mà máy đó chạy. Mặc định là `pc2`. Muốn chọn bộ khác thì đặt `$env:SARI_PROFILE='<tên>'` trước câu lệnh cài. Sau khi cài, sửa file `%USERPROFILE%\SariOps\tools.json` trên từng máy cũng được.

## Tên các máy hiện tại

PC 1 đặt tên các máy theo **tên Windows**, nên cài lại máy nào cũng giữ đúng tên:

| Tên | Tên Windows | Cấu hình |
|---|---|---|
| PC 1 (máy chính) | DESKTOP-D4SAD92 | i9-9900K · 16 luồng · 24GB |
| PC 2 (máy 750) | Admin-PC | i5-10400 · 12 luồng · 16GB |
| PC 3 | DESKTOP-ESH4R6B | chưa báo |
| Laptop (máy 078) | DESKTOP-U7GL1F6 | i7-1185G7 · 8 luồng · 32GB |
