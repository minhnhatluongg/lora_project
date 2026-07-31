// OpenAPI 3.0 spec served at /api/docs via swagger-ui-express.
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'LoRa Smart Farm API',
    version: '1.0.0',
    description:
      'API cho hệ thống nông nghiệp thông minh dùng LoRa (ESP32 Master/Slave).\n\n' +
      '**Xác thực:**\n' +
      '- Người dùng web đăng nhập lấy **JWT** (nút *Authorize* → `bearerAuth`).\n' +
      '- ESP32 dùng header **`x-api-key`** cho các endpoint ghi dữ liệu (`apiKeyAuth`).',
  },
  servers: [{ url: '/', description: 'current host' }],
  tags: [
    { name: 'Auth', description: 'Đăng nhập người dùng' },
    { name: 'Users', description: 'Quản lý tài khoản (admin)' },
    { name: 'Config', description: 'Ngưỡng cảnh báo + luật tự động (admin/technician)' },
    { name: 'Telemetry', description: 'Dữ liệu cảm biến' },
    { name: 'Devices', description: 'Bơm + 4 van' },
    { name: 'Commands', description: 'Hàng đợi lệnh cho ESP32' },
    { name: 'Status', description: 'Trạng thái hệ thống + chế độ' },
    { name: 'Alerts', description: 'Cảnh báo' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: {
      Telemetry: {
        type: 'object',
        description:
          'Một lượt đọc của node STM32: 7 thanh ghi Modbus của đầu dò RS485 + 4 cảm biến siêu âm. ' +
          '`level1..level4` là mức nước (%) do backend suy ra từ `dist1..dist4` và hiệu chuẩn bồn trong `/api/config`.',
        properties: {
          id: { type: 'integer' },
          temperature: { type: 'number', example: 32.5, description: '°C' },
          humidity: { type: 'number', example: 78, description: '% độ ẩm đất' },
          ph: { type: 'number', example: 6.5 },
          ec: { type: 'number', example: 1500, description: 'µS/cm (giá trị thô của đầu dò)' },
          n: { type: 'integer', example: 120, description: 'Đạm, mg/kg' },
          p: { type: 'integer', example: 60, description: 'Lân, mg/kg' },
          k: { type: 'integer', example: 180, description: 'Kali, mg/kg' },
          dist1: { type: 'number', nullable: true, example: 42.5, description: 'cm — null khi cảm biến không phản hồi' },
          dist2: { type: 'number', nullable: true, example: 55 },
          dist3: { type: 'number', nullable: true, example: 31.2 },
          dist4: { type: 'number', nullable: true, example: null },
          level1: { type: 'integer', nullable: true, example: 68, description: '% — suy ra, không lưu trong DB' },
          level2: { type: 'integer', nullable: true, example: 47 },
          level3: { type: 'integer', nullable: true, example: 81 },
          level4: { type: 'integer', nullable: true, example: null },
          lora_rssi: { type: 'integer', example: -72 },
          created_at: { type: 'string', example: '2026-06-23 10:30:30' },
        },
      },
      TelemetryInput: {
        type: 'object',
        description:
          'ESP32 master gửi trọn một lượt đọc. Khoảng cách siêu âm bằng `-1` (STM32 báo hết timeout) ' +
          'được lưu thành `null`. Chấp nhận cả tên biến gốc trong firmware ' +
          '(`Temperature`, `Nitrogen`, `Dist1`, …) lẫn tên rút gọn.\n\n' +
          'Mọi trường đều **tùy chọn** — thiếu trường nào thì lưu `null` trường đó. ' +
          'STM32 tận dụng điều này: khi chưa đọc được đầu dò RS485 lần nào nó chỉ gửi ' +
          '4 khoảng cách siêu âm, tránh ghi nhận pH = 0 rồi bắn cảnh báo giả.',
        properties: {
          temperature: { type: 'number', example: 32.5 },
          humidity: { type: 'number', example: 78 },
          ph: { type: 'number', example: 6.5 },
          ec: { type: 'number', example: 1500, description: 'µS/cm' },
          n: { type: 'integer', example: 120 },
          p: { type: 'integer', example: 60 },
          k: { type: 'integer', example: 180 },
          dist1: { type: 'number', example: 42.5, description: 'cm, -1 = không có phản hồi' },
          dist2: { type: 'number', example: 55 },
          dist3: { type: 'number', example: 31.2 },
          dist4: { type: 'number', example: -1 },
          lora_rssi: { type: 'integer', example: -72 },
          slave_online: { type: 'boolean', example: true },
          sensor_status: {
            type: 'string',
            enum: ['OK', 'CRC', 'HEADER', 'TIMEOUT', 'SHORT'],
            example: 'OK',
            description: 'Kết quả giao dịch Modbus cuối cùng ở STM32',
          },
        },
      },
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'pump' },
          name: { type: 'string', example: 'Bơm nước' },
          state: { type: 'string', enum: ['ON', 'OFF'] },
          updated_at: { type: 'string' },
        },
      },
      Command: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          device_id: { type: 'string', example: 'van1' },
          action: { type: 'string', example: 'ON' },
          status: {
            type: 'string',
            enum: ['pending', 'sent', 'acked', 'expired', 'superseded', 'failed'],
            description:
              'Lệnh gửi đi mà không được ack sẽ tự quay lại `pending` để thử lại; ' +
              'quá số lần thử → `failed`; chờ quá lâu (master offline) → `expired`; ' +
              'bị lệnh mới cho cùng thiết bị thay thế → `superseded`.',
          },
          attempts: { type: 'integer', example: 0 },
          created_at: { type: 'string' },
          sent_at: { type: 'string', nullable: true },
          acked_at: { type: 'string', nullable: true },
        },
      },
      Status: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['AUTO', 'MANUAL'] },
          masterOnline: { type: 'boolean' },
          slaveOnline: { type: 'boolean' },
          loraRssi: { type: 'integer', nullable: true },
          sensorStatus: {
            type: 'string',
            nullable: true,
            enum: ['OK', 'CRC', 'HEADER', 'TIMEOUT', 'SHORT'],
            description: 'Trạng thái đường Modbus RS485 báo về từ STM32',
          },
          sensorErrorAt: { type: 'string', nullable: true },
        },
      },
      Alert: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          level: { type: 'string', enum: ['info', 'warning', 'danger'] },
          message: { type: 'string' },
          created_at: { type: 'string' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          fullName: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'technician', 'viewer'] },
          active: { type: 'boolean' },
        },
      },
      Config: {
        type: 'object',
        properties: {
          thresholds: {
            type: 'object',
            properties: {
              phMin: { type: 'number', example: 5.5 },
              phMax: { type: 'number', example: 7.5 },
              ecMax: { type: 'number', example: 2500, description: 'µS/cm' },
              tempMax: { type: 'number', example: 40 },
              humidityMin: { type: 'number', example: 30 },
              nMin: { type: 'number', example: 50, description: 'mg/kg' },
              pMin: { type: 'number', example: 30 },
              kMin: { type: 'number', example: 60 },
              tankLowPct: { type: 'number', example: 20, description: '% mức nước tối thiểu' },
            },
          },
          tanks: {
            type: 'object',
            description:
              'Hiệu chuẩn 2 điểm cho từng cảm biến siêu âm. Mức nước % = (emptyCm - dist) / (emptyCm - fullCm) × 100.',
            additionalProperties: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Bồn 1' },
                enabled: { type: 'boolean' },
                emptyCm: { type: 'number', example: 100, description: 'Khoảng cách đọc được khi bồn cạn' },
                fullCm: { type: 'number', example: 15, description: 'Khoảng cách đọc được khi bồn đầy' },
              },
            },
          },
          automation: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                metric: {
                  type: 'string',
                  enum: [
                    'temperature', 'humidity', 'ph', 'ec', 'n', 'p', 'k',
                    'dist1', 'dist2', 'dist3', 'dist4',
                    'level1', 'level2', 'level3', 'level4',
                  ],
                },
                op: { type: 'string', enum: ['below', 'above'] },
                value: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Đăng nhập, trả JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin' },
                  password: { type: 'string', example: 'admin123' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'OK – { token, user }' }, 401: { description: 'Sai thông tin' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Thông tin người dùng hiện tại',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'User', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users'], summary: 'Danh sách user (admin)', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Mảng User', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } },
      },
      post: {
        tags: ['Users'], summary: 'Tạo user (admin)', security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['username', 'password'],
            properties: {
              username: { type: 'string' }, password: { type: 'string' },
              fullName: { type: 'string' },
              role: { type: 'string', enum: ['admin', 'technician', 'viewer'] },
            },
          } } },
        },
        responses: { 201: { description: 'Đã tạo' }, 409: { description: 'Trùng username' } },
      },
    },
    '/api/users/{id}': {
      patch: {
        tags: ['Users'], summary: 'Cập nhật user (đổi role / khóa / reset mật khẩu)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' } },
      },
      delete: {
        tags: ['Users'], summary: 'Xóa user (admin)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/config': {
      get: {
        tags: ['Config'], summary: 'Lấy ngưỡng + luật tự động', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Config', content: { 'application/json': { schema: { $ref: '#/components/schemas/Config' } } } } },
      },
      put: {
        tags: ['Config'], summary: 'Cập nhật config (admin/technician)', security: [{ bearerAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Config' } } } },
        responses: { 200: { description: 'Config sau cập nhật' }, 403: { description: 'Không đủ quyền' } },
      },
    },
    '/api/telemetry': {
      post: {
        tags: ['Telemetry'], summary: 'ESP32 gửi dữ liệu cảm biến', security: [{ apiKeyAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TelemetryInput' } } } },
        responses: { 201: { description: 'Đã lưu', content: { 'application/json': { schema: { $ref: '#/components/schemas/Telemetry' } } } } },
      },
    },
    '/api/telemetry/latest': {
      get: { tags: ['Telemetry'], summary: 'Giá trị mới nhất', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Telemetry', content: { 'application/json': { schema: { $ref: '#/components/schemas/Telemetry' } } } } } },
    },
    '/api/telemetry/history': {
      get: { tags: ['Telemetry'], summary: 'Dữ liệu biểu đồ', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }],
        responses: { 200: { description: 'Mảng Telemetry' } } },
    },
    '/api/telemetry/recent': {
      get: { tags: ['Telemetry'], summary: 'N dòng gần nhất', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
        responses: { 200: { description: 'Mảng Telemetry' } } },
    },
    '/api/devices': {
      get: { tags: ['Devices'], summary: 'Trạng thái thiết bị', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Mảng Device', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Device' } } } } } } },
    },
    '/api/devices/{id}/command': {
      post: {
        tags: ['Devices'], summary: 'Bật/tắt thiết bị (admin/technician)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', enum: ['pump', 'van1', 'van2', 'van3', 'van4'] } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { action: { type: 'string', enum: ['ON', 'OFF'] } } } } } },
        responses: { 202: { description: 'Đã đưa vào hàng đợi' }, 403: { description: 'Không đủ quyền' } },
      },
    },
    '/api/devices/state': {
      post: { tags: ['Devices'], summary: 'ESP32 báo trạng thái relay thật', security: [{ apiKeyAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', example: { pump: 'ON', van1: 'OFF' } } } } },
        responses: { 200: { description: 'OK' } } },
    },
    '/api/commands/pending': {
      get: { tags: ['Commands'], summary: 'ESP32 lấy lệnh chờ', security: [{ apiKeyAuth: [] }],
        responses: { 200: { description: 'Mảng Command', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Command' } } } } } } },
    },
    '/api/commands/{id}/ack': {
      post: { tags: ['Commands'], summary: 'ESP32 xác nhận đã thực thi', security: [{ apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' } } },
    },
    '/api/status': {
      get: { tags: ['Status'], summary: 'Trạng thái hệ thống', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } } } } },
    },
    '/api/status/mode': {
      post: { tags: ['Status'], summary: 'Đổi AUTO/MANUAL (admin/technician)', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { mode: { type: 'string', enum: ['AUTO', 'MANUAL'] } } } } } },
        responses: { 200: { description: 'Status' } } },
    },
    '/api/alerts': {
      get: { tags: ['Alerts'], summary: 'Cảnh báo gần nhất', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: { 200: { description: 'Mảng Alert' } } },
      post: { tags: ['Alerts'], summary: 'Tạo cảnh báo', security: [{ apiKeyAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { level: { type: 'string' }, message: { type: 'string' } } } } } },
        responses: { 201: { description: 'Alert' } } },
    },
  },
};
