# Docker 部署说明

## 快速开始

### 1. 创建环境变量文件（可选）

在 `node` 目录下创建 `.env` 文件，配置以下环境变量：

```env
# 数据库配置
DB_HOST=mysql
DB_PORT=3306
DB_USER=library_user
DB_PASS=rootpassword
DB_NAME=library
DB_POOL_SIZE=10

# JWT 配置（生产环境请修改）
JWT_SECRET=change_this_secret_in_production
JWT_EXPIRES_IN=24h

# 服务器配置
PORT=3000
NODE_ENV=production
CORS_ORIGIN=http://localhost:5173

# 文件上传配置（单位：字节，默认2MB）
UPLOAD_MAX_SIZE=2097152
```

**注意：** 如果不创建 `.env` 文件，docker-compose.yml 会使用默认值。

### 2. 构建并启动服务

```bash
# 构建并启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend
docker-compose logs -f mysql
```

### 3. 停止服务

```bash
# 停止服务（保留数据）
docker-compose stop

# 停止并删除容器（数据卷会保留）
docker-compose down

# 停止并删除容器和数据卷（⚠️ 会删除所有数据）
docker-compose down -v
```

## 服务说明

### MySQL 数据库
- **容器名**: `library-mysql`
- **端口**: `3306:3306`
- **数据持久化**: 使用 Docker 数据卷 `mysql_data`
- **健康检查**: 自动检测数据库是否就绪

### 后端服务
- **容器名**: `library-backend`
- **端口**: `3000:3000`（可在 .env 中通过 PORT 修改）
- **文件上传**: `./uploads` 目录挂载到容器内
- **依赖**: 等待 MySQL 健康检查通过后启动

## 数据持久化

- **MySQL 数据**: 存储在 Docker 数据卷 `mysql_data` 中，即使删除容器也不会丢失
- **上传文件**: 存储在 `./uploads` 目录中，与容器内 `/app/uploads` 同步

## 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DB_HOST` | 数据库主机 | `mysql` |
| `DB_PORT` | 数据库端口 | `3306` |
| `DB_USER` | 数据库用户名 | `library_user` |
| `DB_PASS` | 数据库密码 | `rootpassword` |
| `DB_NAME` | 数据库名称 | `library` |
| `JWT_SECRET` | JWT 密钥 | `change_this_secret_in_production` |
| `CORS_ORIGIN` | 允许的前端地址 | `http://localhost:5173` |
| `PORT` | 后端服务端口 | `3000` |

## 常用命令

```bash
# 重新构建镜像
docker-compose build

# 重启服务
docker-compose restart

# 进入容器
docker-compose exec backend sh
docker-compose exec mysql bash

# 查看容器状态
docker-compose ps

# 查看资源使用情况
docker stats
```

## 故障排查

### 数据库连接失败
1. 检查 MySQL 容器是否正常运行：`docker-compose ps`
2. 查看 MySQL 日志：`docker-compose logs mysql`
3. 确认环境变量配置正确

### 后端无法启动
1. 查看后端日志：`docker-compose logs backend`
2. 确认数据库已就绪（后端会等待数据库健康检查）
3. 检查端口是否被占用

### 数据丢失
- MySQL 数据存储在数据卷中，除非使用 `docker-compose down -v`，否则数据不会丢失
- 上传的文件存储在 `./uploads` 目录，确保该目录存在且有写权限

