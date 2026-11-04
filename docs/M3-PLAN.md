# Plan cho M3: BR4 (Trustworthy data) + BR8 (Early response to risks)

Nguồn: `REQUIREMENTS.md`, `WEBAPP.md` (B-M3, C-M3), `AGENTS.md`, code hiện tại trong `web/` và `src/api/`.
Trạng thái: **đã triển khai** trong `web/src/features/alerts`, `web/src/features/quality`, các route `web/src/app/api/{alerts,quality}` và trang `/alerts`, `/quality`; giao diện đã responsive (sidebar thu gọn thành bottom nav dưới 1024 px).

## 1. Phạm vi của M3

| Phần | Nội dung | Nguồn |
|---|---|---|
| Phase 0 | `lib/mock/base.ts`: bộ dữ liệu mock có seed, có sẵn các bất thường cố ý | WEBAPP B-M3 |
| Phase 1 | `/alerts` (BR8), `/quality` (BR4), cùng route handler `app/api/alerts/*` và `app/api/quality/*` | WEBAPP C-M3 |

## 2. Hiện trạng cần biết trước khi code

`web/` hiện là bản scaffold gộp, chưa theo vertical-slice của WEBAPP A9:
- Toàn bộ UI nằm trong một file `web/src/components/dashboard.tsx` (145 dòng). `AlertsView` và `Quality` là bản sơ khai, `/quality` mới chỉ có biểu đồ cột.
- Chưa có `features/`, `components/shared`, `lib/api/schemas.ts`. Mock chỉ có 6 field, khoảng 20 thiết bị, ít alert.
- `web/src/lib/api/client.ts` trộn mock với API và chưa validate bằng Zod.
- Type `Alert` thiếu `acknowledgedAt`, `acknowledgedBy`, `resolvedAt`, `resolvedBy` so với contract A5.

Lệch giữa contract web và FastAPI thật (adapter phải xử lý, theo WEBAPP A4.3):

| Điểm | Contract web | FastAPI hiện tại |
|---|---|---|
| Body PATCH | `{action, by, note}` | `{action, actor, note}` |
| Tên trường | camelCase | snake_case (`alert_id`, `created_at`...) |
| Quality theo thiết bị | có `lineage[]` | `/quality/devices` trả `total/valid/flagged`, chưa có lineage |
| Timeline alert | cần cho drawer | chưa có endpoint; `alert_by_id` có `acknowledged_at`, `resolved_at` nên dựng được timeline 3 mốc |
| Lọc `/alerts` | `status, severity, fieldId` | chỉ lọc `status` |

## 3. Kiến trúc

```
Browser ──► Next.js Route Handler (/api/alerts, /api/quality)   BFF, validate Zod
                │
                ▼
         lib/api/client.ts  (adapter: mock | api, API_KEY server-only)
          ├── DATA_MODE=mock ─► lib/mock/base.ts + alertStore (in-memory)
          └── DATA_MODE=api  ─► FastAPI ─► Cassandra (alerts) | Trino (quality)
```

- `/alerts` chỉ dùng endpoint Cassandra, `/quality` chỉ dùng endpoint Trino. Không trộn nguồn trong một biểu đồ.
- Trình duyệt không gọi FastAPI trực tiếp.
- Alert: `cache: "no-store"`, poll 30 giây. Quality: `revalidate` 300 giây.

Cấu trúc thư mục M3 sở hữu:

```
web/src/
├── app/alerts/page.tsx            (mỏng)      app/quality/page.tsx (mỏng)
├── app/api/alerts/route.ts        GET danh sách
├── app/api/alerts/[id]/route.ts   PATCH (kiểm tra bằng state.ts)
├── app/api/quality/summary/route.ts   app/api/quality/devices/route.ts
├── features/alerts/
│   ├── state.ts           máy trạng thái thuần: open -> acknowledged -> resolved
│   ├── timeline.ts        dựng timeline từ các mốc thời gian
│   ├── hooks.ts           useAlerts, useAlertMutation (optimistic + rollback)
│   ├── responder.ts       tên người xử lý trong localStorage (try/catch)
│   ├── components/        AlertTable, AlertFilters, AlertDrawer, AlertTimeline, ActionDialog
│   ├── mock-store.ts      trạng thái in-memory cho demo
│   └── README.md
├── features/quality/
│   ├── hooks.ts           useQualitySummary, useDeviceQuality
│   ├── lineage.ts         gom lineage, tính tỷ lệ hợp lệ
│   ├── glossary.ts        giải thích bằng tiếng thường: valid, duplicate...
│   ├── components/        QualityStackedBar, DeviceQualityTable, LineageDrawer, TraceView, Glossary
│   └── README.md
└── lib/mock/base.ts + lib/mock/README.md   (Phase 0, bảng fixtures)
```

Phần của M2 (schemas, `useActiveAlerts`) và M4 (`DataPanel`, `FreshnessBadge`, `StatusBadge`, `TimeSeriesChart`) chỉ tái sử dụng, M3 không sửa. Nếu chưa merge, dựng bản tạm trong thư mục feature của M3.

## 4. Phase 0: mock dataset có seed (`lib/mock/base.ts`)

Thứ tự: PRNG có seed (mulberry32) -> reference -> readings và aggregates -> alerts -> quality.

- Quy mô: 3 farm, khoảng 12 field, khoảng 40 thiết bị; mỗi field có crop và target range riêng.
- Readings mỗi 5 phút trong 24 giờ; khoảng 90 ngày aggregate theo giờ, có chu kỳ ngày, mùa và nhiễu.
- Hàm thuần cho từng tài nguyên: `getFarms`, `getFields`, `getDevices`, `getLatest`, `getSeries`, `getIndicators`, `getAlerts`, `getQualitySummary`, `getDeviceQuality`.

Bảng fixtures bất thường (ghi lại trong `lib/mock/README.md`):

| Bất thường | Dữ liệu seed | Nơi thể hiện |
|---|---|---|
| Thiết bị mất kết nối, có khoảng trống | `field-h01-d1` mất 188 phút | `/devices`, series gap, alert outage |
| Thiết bị stale | `field-n02-d2` | `/devices` |
| Pin yếu | `field-r02-d1` (16%) | alert `low_battery` |
| Vượt ngưỡng độ ẩm đất | `field-h01` | alert `threshold` |
| Nhiệt độ tăng đột biến, gắn `suspect` | một điểm trong series | chart |
| Trùng lặp và quarantined | số đếm cố định theo ngày | `/quality` |
| Alert outage tự đóng khi có dữ liệu lại | 1 alert resolved bởi `system` | `/alerts` |

Alert mock có đủ ba trạng thái open, acknowledged, resolved.

Kiểm thử: mọi payload parse qua Zod; cùng seed cho output giống hệt nhau; mỗi bất thường có test riêng; tổng duplicate/quarantined trong `/quality` bằng đúng số trong fixture.

## 5. Phase 1a: `/alerts` (BR8, FR8.3 - FR8.6)

Giao diện:
1. Bảng lọc theo status, severity, type, farm/field, có sắp xếp. Chip trạng thái có chữ, không chỉ dùng màu.
2. Drawer chi tiết: giải thích điều kiện kích hoạt (giá trị quan sát so với ngưỡng), field/thiết bị liên quan, timeline (mở -> ack -> resolved, kèm ai, lúc nào, ghi chú).
3. Nút Acknowledge và Resolve, có hộp ghi chú tùy chọn. Tên người xử lý lấy từ cài đặt "tên của bạn" trong `localStorage`; nếu chưa có thì hiện hộp nhập tên.
4. Cập nhật lạc quan, lỗi thì rollback và báo lỗi.
5. Sau mỗi thay đổi: invalidate query key của `useActiveAlerts` để `/` và `/live` đồng bộ.

`features/alerts/state.ts` (hàm thuần, kiểm thử đầy đủ):

```ts
type Status = "open" | "acknowledged" | "resolved";
const ALLOWED: Record<Status, Status[]> = {
  open: ["acknowledged", "resolved"], acknowledged: ["resolved"], resolved: [],
};
export function transition(current: Status, action: "acknowledge" | "resolve"): Status | InvalidTransition;
export function canAct(status: Status): { acknowledge: boolean; resolve: boolean };
export function autoResolveOutage(alert: Alert, deviceStatus: DeviceStatus): Alert;
```

Ma trận trạng thái phải khớp `ALLOWED_TRANSITIONS` trong `src/api/main.py` (đối chiếu lại khi code).

Route handler:
- `GET /api/alerts`: validate query bằng Zod, `no-store`.
- `PATCH /api/alerts/[id]`: validate body, đọc trạng thái hiện tại rồi gọi `transition()`. Chuyển trạng thái sai trả 409, hành động sai trả 400. Ghi chú tối đa 500 ký tự (khớp FastAPI).
- Hiển thị `note` bằng React text node, không dùng `dangerouslySetInnerHTML`. Có test với chuỗi `<img onerror>`.

## 6. Phase 1b: `/quality` (BR4, FR4.5, FR4.6, FR4.7)

Giao diện:
1. Biểu đồ cột chồng theo ngày: valid, duplicate, out-of-range, quarantined. Có chọn khoảng ngày, bảng thay thế và `aria-label`.
2. Bảng chất lượng theo thiết bị; bấm vào xem lineage: batch id, topic/partition/offset, thời điểm ingest.
3. Panel giải thích từng thuật ngữ bằng ngôn ngữ thường. Lineage kỹ thuật chỉ xuất hiện ở trang này.
4. Traceability view: chọn một giá trị đang hiển thị và xem nó đến từ batch/offset nào (khi dữ liệu mock hỗ trợ).
5. "Data as of ..." trên mỗi panel, ghi rõ dữ liệu không phải live.

Chế độ api: `/quality/devices` chưa có lineage và chưa có điểm `suspect`. Adapter map phần có sẵn, phần thiếu hiện "chưa có dữ liệu". Mock dựng đủ theo contract A5.

## 7. Kiểm thử và tiêu chí hoàn thành

| Tiêu chí (WEBAPP C-M3) | Cách chứng minh |
|---|---|
| Ack rồi resolve cập nhật bảng, timeline, active-alerts ở trang khác | Test hook và kiểm tra invalidation |
| Chuyển trạng thái sai không thể từ UI, bị route handler từ chối | Test `state.ts` (toàn bộ ma trận) và test handler trả 409 |
| Duplicate/quarantined mock khớp số trong chart và bảng | Test so khớp với fixture |
| Ghi chú alert hiển thị an toàn | Test với chuỗi chứa HTML |

Cuối mỗi milestone chạy `bun run lint`, `typecheck`, `test`, `build`. Mỗi feature có README (làm gì, endpoint nào, hạn chế). Trang chạy được trên mobile và desktop, có skeleton, empty và error state.

## 8. Thứ tự thực hiện

1. M-A (Phase 0): PRNG, reference, alerts và quality seed, bảng fixtures, test Zod. Phụ thuộc schemas của M2; nếu chưa có thì dùng type trong `lib/types.ts` rồi chuyển sang Zod sau.
2. M-B: `state.ts`, `timeline.ts` cùng unit test. Logic thuần, không phụ thuộc ai, làm sớm nhất.
3. M-C: route handler alerts/quality, mock-store, mở rộng adapter.
4. M-D: UI `/alerts` (bảng, drawer, mutation).
5. M-E: UI `/quality` (chart, bảng, lineage, traceability, glossary).
6. M-F: adapter chế độ api cho alerts và quality, README, kiểm tra checklist Part E.

## 9. Rủi ro

- M2 và M4 chưa merge schemas và shared UI nên M3 có thể phải dựng bản tạm. Giảm rủi ro: làm M-B trước vì độc lập.
- `lib/mock/base.ts` thuộc M3 nhưng M1, M2, M4 đều dùng. Đổi hình dạng dữ liệu ảnh hưởng cả nhóm, cần chốt contract sớm.
- Mã trong `web/` sẽ đổi cấu trúc khi M1 tách vertical slice. M3 nên phối hợp với M1 trước khi tạo thư mục.

## 10. Cần quyết định trước khi code

1. **Phạm vi:** chỉ làm web, hay làm cả backend còn thiếu (FastAPI trả lineage, timeline, lọc severity)? Đề xuất: chỉ làm web; ở chế độ api hiện "chưa có dữ liệu" cho phần thiếu và mở issue cho người phụ trách API.
2. **Cấu trúc:** làm theo vertical-slice như WEBAPP hay thêm vào `dashboard.tsx`? Đề xuất: tách `features/alerts` và `features/quality` để khỏi xung đột.
3. **Branch:** theo quy ước WEBAPP là `feat/m3-alerts-quality`, tạo từ `main` mới nhất.
