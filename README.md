# 崔同学的数学博客[开源项目]
> 一款基于node.js开发的数学博客系统，对数学公式有很高的支持度

立刻体验：<https://hvril.cn/>
<img width="1692" height="618" alt="image" src="https://github.com/user-attachments/assets/6eb46fb2-ae7a-4dc9-bd88-e49c1b5705f6" />
<img width="1531" height="601" alt="image" src="https://github.com/user-attachments/assets/7100b3d1-e531-4699-9e14-f6c938ef8712" />
<img width="1472" height="801" alt="image" src="https://github.com/user-attachments/assets/0b88b298-07d7-4491-aa28-047afd05e373" />


<p align = "left">
  <img src="./github_images/auth.png" width="15%"/>
  <img src="./github_images/update.png" width="15%"/>
  <img src="./github_images/Tool.png" width="15%"/>
  <img src="./github_images/version.png" width="15%"/>
</p>

## 环境要求

(1)<code>node.js</code>,the recommend version is v24.16.0 <br />
(2)<code>vite</code> environment,the dev version is v8.1 <br />
(3)<code>React</code>,the dev version is v19.0 <br />
(4)<code>TypeScript</code>,v7.0 <br />
(5)<code>Tailwind CSS</code>,v3.4 <br />
(6)<code>Axios</code>,v1.18//API requests <br />
(7)<code>**TipTap**</code>,v3.28//Article edit(include from,photo,color,align,link,code) <br />
(8)<code>Lowlightv</code>,the dev version is v3.3 <br />
(9)<code>**MathLive**</code>,v0.110,LaTex formule support <br />
(10)<code>**KaTeX**</code>,v0.18 <br />
(11)<code>**MathJax**</code>,the core tool,v4.1//SVG 公式渲染(used to copy to other edit like wechat public platform,zhihu and so on) <br />
(12)<code>Express</code>:v4.21 <br />
(.n.)Others,let 'npm install' to done it. <br />

## 启动方法

#### 1.克隆项目(Clone this project)
1-1.在PC/服务器指定目录开启Git Bash
运行以下命令：
```
git clone git@github.com:YeRanHvril/Student-Cui-math-blog.git
```
1-2或者选择Download ZIP并转存到目标目录/服务器
#### 2.安装依赖(Run the installer)
2-1.直接在目标目录下(include package.json)，cmd运行
```
npm install
```
#### 3.启动(npm start)
3-1.直接在目标目录下,cmd运行
```
npm start
```
3-1.Windows下直接运行<code>start.bat</code>
> 默认账号密码为admin,密码未知
#### 4.修改密码
还是直接在目标目录下,cmd运行
```
node src/scripts/change-password.js
```
会得到
```
=== 密码修改工具 ===

现有用户列表：
  ID: 1  |  用户名: admin  |  邮箱: admin@math-blog.com
请输入要修改密码的用户名:
```
然后输入admin后填写自己的密码，即可访问后台！
