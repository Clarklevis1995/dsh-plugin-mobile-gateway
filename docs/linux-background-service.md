# Linux 持久化后台运行

在网关设置的「通用」页面开启「持久化后台运行」，即可将当前 `dsh web` 实例交给 systemd 用户服务托管。SSH 断开、用户退出登录后继续运行，服务器重启后自动启动；异常退出时自动重试（60 秒内最多启动 5 次）。开启时整个 DSH Web 会重启，网页和手机会短暂断开，正在执行的任务可能中断，请等任务结束后再开启。

仅在 Linux 上显示此开关，要求通过 `dsh web` 启动，并且 systemd 用户服务可访问。不依赖公网接入 Helper，也不需要为 DSH 提供 root 权限。不支持无 systemd 的容器或发行版；此时开关禁用并显示原因。

开启时检查 linger，必要时尝试为当前用户启用。如果权限不足，页面提示在服务器执行 `sudo loginctl enable-linger <用户 UID>`，完成后重新开启开关。linger 的作用参见 [systemd 官方文档](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html)。关闭开关不会禁用用户的 linger，避免影响其他用户服务。

关闭开关会取消下次开机自动启动，当前 DSH Web 仍在后台运行；通过网关右上角工具菜单可以停止。后台托管时，工具菜单中的重启、停止均交给 systemd，停止后不会立即自动拉起；若开关仍开启，服务器下次启动仍会启动服务。

服务名为 `dsh-mobile-gateway-<实例标识>.service`，可从 `/mgw/status` 的 `backgroundService.unit` 读取。同一工作目录、DSH_HOME 和启动参数对应同一个服务，不同实例分别保存。设置保存于 `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`；服务文件及启动快照权限为 0600。启动快照包含当前 Node 路径、DSH 参数、工作目录和环境变量（可能包含凭据），不要公开或提交这些文件。Node、DSH 或插件安装位置改变后，应从新安装启动并重新开启开关，以更新启动快照。

命令行管理（把 `<服务名>` 替换为实际名称）：

```sh
systemctl --user status <服务名>
journalctl --user -u <服务名> -n 100
systemctl --user restart <服务名>
systemctl --user stop <服务名>
systemctl --user disable <服务名>
```

「网关运行模式」中的「常驻开启」控制是否持续接受手机连接；如需服务器重启后持续提供手机入口，请同时选择「常驻开启」。
