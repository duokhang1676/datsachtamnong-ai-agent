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
- Resend API (gửi email thông báo)
- Google Cloud Text-to-Speech (TTS tiếng Việt)
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
7. Gửi email thông báo qua Resend
8. Frontend gọi TTS API để phát giọng đọc bài viết

## 3) API chính

Base URL mặc định: `http://localhost:4000`

### Public
- `GET /`
  - Kiểm tra service đang chạy
- `GET /api/health`
  - Health check chi tiết: trạng thái service, uptime, scheduler, context runtime

### TTS
- `POST /api/tts/generate`
  - Tạo file MP3 từ text và trả URL public
  - Body:
    ```json
    {
      "text": "Nội dung bài viết...",
      "lang": "vi-VN",
      "slow": false
    }
    ```
- `GET /api/tts/audio/:filename`
  - Trả file audio đã cache

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
NODE_ENV=development
PORT=4000
APP_BASE_URL=http://localhost:4000

OPENAI_API_KEY=
PEXELS_API_KEY=

API_BASE_URL=http://localhost:5000/api
AGENT_EMAIL=
AGENT_PASSWORD=

DEFAULT_NEWS_CATEGORY_ID=
NEWS_PUBLISH_CRON_ENABLED=true
NEWS_PUBLISH_CRON=0 10 * * *
NEWS_PUBLISH_CRON_TIMEZONE=Asia/Ho_Chi_Minh
NEWS_PUBLISH_ON_STARTUP=false

DISABLE_NOTIFICATION_EMAIL=false
REVIEWER_EMAIL=
NOTIFICATION_EMAIL=
RESEND_API_KEY=
RESEND_PUBLISHED_TEMPLATE_ID=
RESEND_FROM_EMAIL=
EMAIL_FROM=
EMAIL_USER=

GCP_PROJECT_ID=
GCP_TTS_VOICE_NAME=vi-VN-Neural2-A
GCP_TTS_CREDENTIALS_JSON=
GOOGLE_APPLICATION_CREDENTIALS=
```

Ghi chú:
- `OPENAI_API_KEY` bắt buộc cho các agent AI.
- `PEXELS_API_KEY` dùng cho tìm ảnh; thiếu key thì pipeline ảnh fallback.
- `API_BASE_URL`, `AGENT_EMAIL`, `AGENT_PASSWORD` bắt buộc để login và publish sang backend.
- `RESEND_API_KEY` và `RESEND_FROM_EMAIL` bắt buộc nếu bật email thông báo.
- `RESEND_PUBLISHED_TEMPLATE_ID` là tùy chọn; nếu không có thì service fallback về nội dung HTML/TEXT hardcoded.
- Với `RESEND_PUBLISHED_TEMPLATE_ID`, template cần có đúng các biến: `title`, `summary`, `categoryName`, `articleUrl`.
- `GCP_TTS_CREDENTIALS_JSON` (hoặc `GOOGLE_APPLICATION_CREDENTIALS`) bắt buộc để sinh audio TTS.

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
- `APP_BASE_URL`
- `REVIEWER_EMAIL` hoặc `NOTIFICATION_EMAIL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `GCP_PROJECT_ID`
- `GCP_TTS_CREDENTIALS_JSON` (khuyến nghị) hoặc `GOOGLE_APPLICATION_CREDENTIALS`
- `DEFAULT_NEWS_CATEGORY_ID`

### Environment variables khuyến nghị
- `PEXELS_API_KEY`
- `RESEND_PUBLISHED_TEMPLATE_ID`
- `EMAIL_FROM`
- `EMAIL_USER`
- `NEWS_PUBLISH_CRON_ENABLED`
- `NEWS_PUBLISH_CRON`
- `NEWS_PUBLISH_CRON_TIMEZONE`
- `NEWS_PUBLISH_ON_STARTUP`

Lưu ý:
- Render tự cấp `PORT`; app đã hỗ trợ đọc `process.env.PORT`.
- Trên production, không đặt `API_BASE_URL` là `localhost`/`127.0.0.1`; service đã có guard và sẽ fail fast.
- Với Google TTS, hệ thống chia text theo giới hạn byte UTF-8 để tránh lỗi `input.text longer than limit of 5000 bytes`.

---