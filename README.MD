# (WIP)SuperScanner

SuperScanner 是一个强大的扫描器工具，结合了现代化的前端界面和高效的 Rust 后端。它允许用户管理扫描任务、监控后端服务器，并处理复杂的扫描项目。

## 功能特性

- **任务管理**：创建、监控和执行扫描任务
- **后端服务器管理**：添加和管理多个后端服务器
- **扫描项目处理**：支持复杂的扫描工作流和命令执行
- **实时状态监控**：通过 gRPC 协议实时获取任务和服务器状态
- **多语言支持**：支持英文和中文界面
- **现代化 UI**：使用 React 和 Tailwind CSS 构建的美观界面

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + Radix UI
- **后端**：Rust + Tonic (gRPC) + SQLx (SQLite)
- **桌面应用**：Tauri 2.0
- **状态管理**：Zustand + TanStack Query
- **国际化**：i18next

## 安装和运行

### 前提条件

- [Rust](https://rustup.rs/) (推荐最新稳定版)
- [Node.js](https://nodejs.org/) (版本 18 或更高)
- [pnpm](https://pnpm.io/) (推荐包管理器)

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone <repository-url>
   cd SuperScanner
   ```

2. **安装前端依赖**
   ```bash
   cd client
   pnpm install
   ```

3. **构建项目**
   ```bash
   cd ..
   cargo build
   ```

4. **运行开发版本**
   ```bash
   cargo tauri dev
   ```

5. **构建生产版本**
   ```bash
   cargo tauri build
   ```

## 项目结构

```
SuperScanner/
├── client/                 # 前端应用 (React + TypeScript)
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── hooks/         # React hooks
│   │   ├── lib/           # 工具库
│   │   ├── locales/       # 国际化文件
│   │   ├── routes/        # 路由组件
│   │   └── views/         # 页面视图
│   ├── package.json
│   └── vite.config.ts
├── server/                 # Rust 后端服务器
│   ├── src/
│   │   ├── core/          # 核心业务逻辑
│   │   ├── proto/         # gRPC 服务实现
│   │   └── storage/       # 数据存储层
│   ├── Cargo.toml
│   └── migrations/        # 数据库迁移
├── src-tauri/             # Tauri 配置和原生代码
├── proto/                 # Protocol Buffers 定义
└── scanner-projects/      # 扫描项目数据存储
```

## 开发

### 运行后端服务器

```bash
cd server
cargo run
```

### 运行前端开发服务器

```bash
cd client
pnpm dev
```

### 数据库迁移

项目使用 SQLite 数据库，迁移文件位于 `server/migrations/`。

## 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 许可证

本项目采用 GPL 3.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 联系

如果您有任何问题或建议，请创建 Issue 或联系维护者。