# dsh-superagent-reset

「设置 → 通用」里的一行：**初始化 Superagent 会话**。

它把 master 会话的历史（连同两份投影缓存）搬进 `$DSH_HOME/backups/reset-<时间戳>/`，
让日常页回到一条空会话。工单、设置、提示词修订（`orchestrator.sqlite`）、ActMem 记忆卡、
人格文件、skills **都不动**。

## 为什么是「排队」而不是立刻执行

host 跑着的时候，`sessions/--…superagent-local--/orchestrator-…/session.v4.jsonl.zstd`
正是它打开着的文件，`orchestrator.sqlite-shm` 也归它。这时候 rename 只会得到一个
半搬走的状态。所以设置页只写一个标记 `$DSH_HOME/superagent-reset.json`，真正的搬移由
`scripts/vivy-dsh.mjs` 在下次 `npm start`、host 还没起来之前做。

搬失败（文件被占、目录挡路）时标记会保留，下次启动再试一次；结果写在
`$DSH_HOME/superagent-reset.last.json`，设置页会回显「上次执行」。

## 搬什么

| 目标 | 说明 |
| --- | --- |
| `sessions/*state-superagent-local*/orchestrator-*/` | master 会话日志 |
| `storages/session_projcache/sessions/orchestrator-*.json` | 这条会话的投影缓存 |
| `storages/dsh-context/overview-cache.v1.json` | 上下文洞察缓存（会重算） |

一个字节都不删：rename 进备份目录，随时搬回来。

## 接口

host 半边挂在 `/dsh-superagent-reset/api`：

- `GET /status` → `{ pending, last, targets: [{ label, path, exists, bytes }] }`，`path` 是相对 `$DSH_HOME` 的路径，绝不回绝对路径。
- `POST /queue` → 要 `content-type: application/json` 且请求体 `{ confirm: true }`；重复提交幂等。
- `POST /cancel` → 取消排队。

校验照 `dsh-laputa/src/http.ts` 的三层：只认本机 host、非 GET 要求同源、再过一道
`connection.requestRejection`。

## 接线

- `plugins/dsh-superagent-reset/` 与 `plugins/dsh-daily/` 一样是独立源码 bundle（`dsh.bundle.patch` + `dsh.client`），由 diva-dsh 根仓通过 submodule 锚定版本。
- 要在 profile 里出现，得先在根仓库的 `scripts/lib/component-setup.mjs` 的 `componentPackages()` 里（已加），然后 `npm run stop` → `npm run setup:components` → `npm start`。之后启动器每次启动都会顺手消费排队标记。

## 测试

`node --test tests/superagent-reset.test.mjs`（11 例：目标盘点、排队/取消/坏标记、搬移成功与失败、
`describe` 不泄露绝对路径、路由的确认/幂等/跨站/非本机、客户端注册形状）。
