# AI Marketing Agent

Hệ thống AI tự động tạo và publish bài viết cho website nông nghiệp, bao gồm các bước:
- Nghiên cứu topic
- Viết nội dung
- Tối ưu SEO
- Lập kế hoạch ảnh, tìm ảnh và chọn ảnh phù hợp bằng AI
- Publish sang backend CMS
- Gửi email thông báo

## 1) Công nghệ sử dụng

### Runtime và API
- Node.js
- TypeScript
- Express 5
- CORS
- dotenv

### AI và workflow
- OpenAI API
- LangChain (`@langchain/openai`, `langchain`)
- Mastra workflow (`@mastra/core/workflows` được load động)

### Scheduler và tiện ích
- node-cron
- cron-parser
- marked (markdown -> html)

### Tích hợp hệ thống
- Axios (gọi backend API)
- Nodemailer (gửi email)
- Mongoose (có trong dependencies cho tích hợp dữ liệu mở rộng)

## 2) Kiến trúc tổng quan

### Entry point
- `src/app.ts`

### Các nhóm chính
- `src/agents`: các agent chuyên trách (`topic`, `content`, `seo`, `keywordSelection`, `imageSelection`)
- `src/workflows`: workflow điều phối end-to-end
- `src/services`: publish, auth, email, ảnh, context config, scheduler run store
- `src/routes`: API routes cho health, admin, run agent, approval
- `data`: dữ liệu cục bộ (`agent-context-config.json`, `pending-articles.json`)

### Luồng chạy mặc định
1. Scheduler hoặc manual trigger gọi `runContentWorkflow`
2. Topic Agent sinh topic
3. Content Agent viết bài
4. SEO Agent tối ưu metadata
5. Image pipeline:
   - Planner lập plan ảnh
   - Keyword Selection Agent tối ưu từ khóa ảnh
   - Search ảnh qua Pexels
   - Image Selection Agent chọn ảnh tốt nhất theo alt mô tả + context bài
6. Publish bài sang backend
7. Gửi email thông báo

## 3) API chính

Base URL mặc định: `http://localhost:4000`

### Public
- `GET /`
  - Kiểm tra service đang chạy
- `GET /api/health`
  - Health check chi tiết: trạng thái service, uptime, scheduler, context runtime

### Agent runtime
- `POST /api/agents/run`
  - Chạy workflow theo goal tùy ý
  - Body:
    ```json
    {
      "goal": "Tạo bài viết về cải tạo đất hữu cơ",
      "context": { "optional": true }
    }
    ```

### Approval
- `GET /approve/:id`
- `GET /reject/:id`
- `GET /api/approval/approve/:id`
- `GET /api/approval/reject/:id`

### Agent admin
- `GET /api/agent-admin/dashboard`
- `GET /api/agent-admin/runs?limit=30&status=success`
- `POST /api/agent-admin/runs/trigger`
- `GET /api/agent-admin/config`
- `POST /api/agent-admin/config/validate`
- `PUT /api/agent-admin/config`
- `GET /api/agent-admin/context`
- `PUT /api/agent-admin/context`
- `POST /api/agent-admin/context/reset`

## 4) Biến môi trường

File mẫu: `.env.example`

```env
PORT=4000
NODE_ENV=development
OPENAI_API_KEY=
EMAIL_USER=
EMAIL_PASS=
API_BASE_URL=http://localhost:5000/api
AGENT_EMAIL=
AGENT_PASSWORD=
REVIEWER_EMAIL=
APP_BASE_URL=http://localhost:4000
DEFAULT_NEWS_CATEGORY_ID=
PEXELS_API_KEY=
NEWS_PUBLISH_CRON_ENABLED=true
NEWS_PUBLISH_CRON=0 10 * * *
NEWS_PUBLISH_CRON_TIMEZONE=Asia/Ho_Chi_Minh
NEWS_PUBLISH_ON_STARTUP=false
```

Ghi chú:
- `OPENAI_API_KEY` bắt buộc cho các agent AI.
- `PEXELS_API_KEY` dùng cho tìm ảnh; thiếu key thì pipeline ảnh fallback.
- `API_BASE_URL`, `AGENT_EMAIL`, `AGENT_PASSWORD` bắt buộc để publish sang backend.

## 5) Cài đặt và chạy

### Cài dependencies
```bash
npm install
```

### Chạy development
```bash
npm run dev
```

### Build production
```bash
npm run build
```

### Chạy bản build
```bash
npm run start
```

## 6) Dữ liệu được lưu ở đâu

- Agent context config: `data/agent-context-config.json`
- Pending articles: `data/pending-articles.json`
- Run history scheduler: lưu in-memory trong tiến trình (`agentRunStore`), reset khi restart service

## 7) Scheduler

Scheduler khởi động cùng app bằng `startContentPublishScheduler()`.

Config qua env hoặc API admin:
- Bật/tắt cron
- Cron expression
- Timezone
- Run on startup

Có thể xem lịch chạy gần nhất qua:
- `GET /api/agent-admin/config`
- `GET /api/health` (trường `scheduler.nextRun`)

## 8) Health check mẫu

```bash
curl http://localhost:4000/api/health
```

Kỳ vọng trả về dạng:
```json
{
  "status": "healthy",
  "service": "ai-marketing-agent",
  "online": true,
  "timestamp": "2026-03-23T...Z",
  "uptimeSeconds": 123,
  "scheduler": {
    "enabled": true,
    "isRunning": false,
    "cronExpression": "0 10 * * *",
    "timezone": "Asia/Ho_Chi_Minh",
    "nextRun": "2026-03-24T03:00:00.000Z"
  },
  "context": {
    "imagePlannerModel": "gpt-4o-mini",
    "imageProviderOrder": ["pexels", "fallback"],
    "topicsPerRun": 5
  }
}
```

## 9) Ghi chú vận hành

- Nếu log báo lỗi đọc context config JSON, kiểm tra cú pháp file `data/agent-context-config.json`.
- Khi chỉnh context từ trang admin, cấu hình sẽ được normalize và ghi lại xuống file JSON.
- Nên giới hạn temperature thấp cho image pipeline để giữ ổn định chọn keyword/ảnh.

## 10) Scripts hỗ trợ

- `npm run workflow`: build + chạy test workflow từ `dist/testWorkflow.js`
- `npm run workflow:esm`: chạy test workflow bằng loader ESM

## 11) Deploy lên Render

Project đã có sẵn file `render.yaml` để deploy nhanh.

### Cách 1: Blueprint (khuyến nghị)
1. Push code lên GitHub.
2. Trong Render, chọn `New +` -> `Blueprint`.
3. Chọn repository `datsachtamnong-ai-agent`.
4. Render sẽ đọc `render.yaml` và tạo web service.

### Cách 2: Tạo Web Service thủ công
1. `Runtime`: Node
2. `Root Directory`: `ai-marketing-agent`
3. `Build Command`: `npm install && npm run build`
4. `Start Command`: `npm run start`
5. `Health Check Path`: `/api/health`

### Environment variables bắt buộc trên Render
- `OPENAI_API_KEY`
- `API_BASE_URL`
- `AGENT_EMAIL`
- `AGENT_PASSWORD`
- `EMAIL_USER`
- `EMAIL_PASS`
- `REVIEWER_EMAIL`
- `APP_BASE_URL`
- `DEFAULT_NEWS_CATEGORY_ID`

### Environment variables khuyến nghị
- `PEXELS_API_KEY`
- `NEWS_PUBLISH_CRON_ENABLED`
- `NEWS_PUBLISH_CRON`
- `NEWS_PUBLISH_CRON_TIMEZONE`
- `NEWS_PUBLISH_ON_STARTUP`

Lưu ý: Render tự cấp `PORT`; app đã hỗ trợ đọc `process.env.PORT`.

---
Nếu cần, có thể tách thêm tài liệu riêng cho API contract (OpenAPI) và playbook deploy production (PM2/Docker/Nginx).
