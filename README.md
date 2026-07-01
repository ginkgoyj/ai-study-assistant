# 课程复习

一个本地前端学习工具，支持解析 `PDF / DOCX / PPTX`，生成复习重点文档，并基于资料生成练习题和错题记录。

## 功能

- 上传并解析 `PDF / DOCX / PPTX`
- 提取资料文本
- 调用 AI 接口生成结构化复习重点
- 导出 `.docx` 格式复习重点
- 生成选择题和大题
- 记录错题并按批次保存
- 本地保存配置、题组和生成记录

## 技术栈

- React
- Vite
- JavaScript / JSX
- `pdfjs-dist`
- `mammoth`
- `jszip`
- `fast-xml-parser`
- `lucide-react`
- 浏览器 `localStorage`
- 本地开发代理中间件

## 开发环境

- Node.js
- npm
- 现代浏览器

## 项目结构

- 主版本：
  - `main-version/src/main.jsx`
  - `main-version/src/styles.css`
  - `main-version/server/api-proxy.js`
  - `main-version/vite.config.js`
  - `main-version/package.json`
- 另一版实现：
  - `alt-version/src/main.jsx`
  - `alt-version/src/styles.css`
  - `alt-version/server/api-proxy.js`
  - `alt-version/vite.config.js`
  - `alt-version/package.json`

当前仓库保留两个版本。`main-version` 为主版本，`alt-version` 保留另一套界面和代码组织方式。

## 核心实现

### React 界面

页面围绕三部分组织：

- 资料上传
- 题目练习
- 错题本

主版本使用标签页切换上传、练习和错题区域，并通过状态控制通知、加载状态、当前题目、已选答案和错题批次。

### 文件解析

不同文件格式分别使用不同方案：

- PDF：`pdfjs-dist` 逐页提取文本
- DOCX：`mammoth` 提取原始文字
- PPTX：`jszip` 解压后读取幻灯片 XML，再用 `fast-xml-parser` 抽取文本节点

解析结果会统一整理成文本，用于后续总结和出题。

### AI 接口调用

前端提供 `API Base URL`、模型名和 `API Key` 配置项，开发环境下通过本地代理转发请求。主版本会根据不同任务构造不同提示词，请求返回 JSON，再分别进入复习重点生成和题目生成流程。

### 复习重点导出

主版本会把标题、总览、重点条目、公式、易错点和复习建议整理为 `.docx` 内容，并加入生成文件列表。

### 练习与错题

选择题支持逐题作答、即时展示解析、统计结果和记录错题；大题支持展开参考答案，并可手动加入错题本。错题数据按批次存放在本地，支持回看和重练。

## 如何运行

运行主版本：

```powershell
cd main-version
npm.cmd install
npm.cmd run dev
```

运行另一版：

```powershell
cd alt-version
npm.cmd install
npm.cmd run dev
```

默认开发地址：

```text
http://127.0.0.1:5173/
```

## 项目展示

仓库中暂未单独整理界面截图。页面包含上传区、练习区、错题本和设置面板，运行后可直接查看完整交互。

## 后续优化方向

- 统一两个版本的数据结构和接口封装
- 为文件解析和题组规范化补充测试
- 增加扫描版 PDF 的文字识别支持

## AI 参与说明

项目开发过程中使用了 AI 作为辅助工具，主要用于接口调试、代码实现思路整理、文档查阅和问题分析；实际功能接入、运行验证、交互调整和代码修改由本人完成。
