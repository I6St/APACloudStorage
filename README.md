# APACloudStorage
私用云存储服务

## 介绍
本项目是一个基于 Node.js 的 Express 应用，用于存储和管理私有文件。
项目部署在 [这里](https://s.apakp.top/)

## 部署
1. 克隆项目到本地
```bash
git clone https://github.com/I6St/APACloudStorage.git
cd APACloudStorage/
```
2. 安装依赖
```bash
npm install
```
3. 修改 `server.js` 中的网址为你自己的
4. 将 PEM 格式的证书放在 `certificate.crt`，私钥放在 `private.key` 
5. 启动应用
```bash
npm start
```
