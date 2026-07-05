# Mew Lua

Mew Lua 是一个面向 VS Code 的 Lua 语言客户端扩展。

上游语言分析器为 [EmmyLuaLs/emmylua-analyzer-rust](https://github.com/EmmyLuaLs/emmylua-analyzer-rust)。

## 功能

- 控制 EmmyLua 语言服务器。
- 提供 `.emmyrc.json` 多语言提示。
- 支持查看当前文档的语法树。
- 重写 vscode 内置的 lua 语法高亮。

## 配置

可在 .vscode/settings.json 中配置以下选项:

| 配置项 | 说明 |
| --- | --- |
| `mewlua.ls.executablePath` | 语言服务器可执行文件路径。留空时使用扩展内置的可执行文件。 |
| `mewlua.ls.startParameters` | 传递给语言服务器进程的启动参数。 |
| `mewlua.ls.globalConfigPath` | 可选的全局 EmmyLua 配置文件路径。 |


## License

本项目遵循仓库内 `LICENSE` 文件声明的许可证。上游项目许可证与贡献规范请以
[EmmyLuaLs/emmylua-analyzer-rust](https://github.com/EmmyLuaLs/emmylua-analyzer-rust) 为准。
