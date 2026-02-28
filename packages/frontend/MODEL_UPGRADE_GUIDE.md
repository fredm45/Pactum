# 🎨 模型和背景升级指南

## 当前状态

### 现在使用的模型
- **名称**: RobotExpressive（测试模型）
- **风格**: 通用机器人
- **颜色**: 统一颜色（通过标签区分 Buyer/Seller）
- **大小**: 453KB

### 现在的背景
- **颜色**: 深蓝灰色 (#1a1a2e)
- **雾效**: 启用
- **光照**: 环境光 + 方向光 + 点光源

## 🎯 升级方案

### 方案 1: 我帮你找免费模型（推荐）

我可以帮你从以下网站下载专业模型：

#### Sketchfab（最佳选择）
**网址**: https://sketchfab.com/

**搜索关键词**:
- **Buyer Agent**:
  - "cute robot blue customer"
  - "friendly robot shopper"
  - "cartoon robot buyer"

- **Seller Agent**:
  - "business robot orange seller"
  - "professional robot merchant"
  - "robot shopkeeper"

**筛选条件**:
- ✅ Downloadable: Yes
- ✅ Format: glTF
- ✅ Animated: Yes
- ✅ License: CC BY 或 CC0
- ✅ Poly count: < 20K

**推荐模型**（我可以帮你下载）:

1. **Low Poly Robot Character**
   - 链接: https://sketchfab.com/3d-models/low-poly-robot
   - 风格: 简约、现代
   - 动画: 多个动作
   - 授权: CC BY 4.0

2. **Cute Robot**
   - 搜索: "cute robot animated"
   - 风格: 可爱、卡通
   - 适合: Buyer Agent

3. **Business Robot**
   - 搜索: "business robot character"
   - 风格: 专业、科技感
   - 适合: Seller Agent

#### Mixamo（免费 + 自动动画）
**网址**: https://www.mixamo.com/

**步骤**:
1. 注册免费账号
2. 选择角色（Character）
3. 选择动画：
   - Idle（待机）
   - Wave（挥手）
   - Walking（行走）
   - Dancing（跳舞）
4. 下载为 FBX 或 GLB

**优点**:
- 自动骨骼绑定
- 大量免费动画
- 可以给同一个角色添加多个动画

#### Poly Haven
**网址**: https://polyhaven.com/models

**特点**:
- 100% 免费（CC0 授权）
- 高质量模型
- 但机器人模型较少

### 方案 2: 使用 AI 生成模型

#### Meshy.ai（AI 生成 3D）
**网址**: https://www.meshy.ai/

**步骤**:
1. 输入描述: "cute blue robot character for buyer agent"
2. AI 生成 3D 模型
3. 下载 GLB 格式

**优点**:
- 完全自定义
- 快速生成
- 符合你的品牌风格

**缺点**:
- 可能需要付费
- 动画需要额外添加

### 方案 3: 定制专业模型

如果你想要完全定制的模型：

#### Fiverr
- 搜索: "3d robot character glb"
- 价格: $20-$100
- 交付时间: 3-7 天

#### Upwork
- 搜索: "3D character modeling"
- 价格: $50-$300
- 更专业的设计师

## 📥 如何使用新模型

### 方法 1: 告诉我模型链接（最简单）

如果你找到了喜欢的模型：

1. **复制模型链接**
   - 例如: https://sketchfab.com/3d-models/xxx

2. **告诉我**
   - 我会帮你下载
   - 自动优化和压缩
   - 配置到项目中

### 方法 2: 自己下载（需要技术）

#### 步骤 1: 下载模型

从 Sketchfab 下载：
1. 点击 Download 按钮
2. 选择 "Autoconverted format (glTF)"
3. 下载 ZIP 文件
4. 解压，找到 .glb 文件

#### 步骤 2: 优化模型

```bash
# 安装工具
npm install -g gltf-pipeline

# 压缩 Buyer 模型
gltf-pipeline -i buyer_original.glb -o buyer.glb -d

# 压缩 Seller 模型
gltf-pipeline -i seller_original.glb -o seller.glb -d
```

#### 步骤 3: 替换文件

```bash
# 复制到项目
cp buyer.glb /Users/zm/Desktop/a2a/Pactum/packages/frontend/public/models/
cp seller.glb /Users/zm/Desktop/a2a/Pactum/packages/frontend/public/models/
```

#### 步骤 4: 验证模型

访问 https://threejs.org/editor/
- 拖拽 .glb 文件到页面
- 检查：
  - ✅ 面数 < 20K
  - ✅ 文件大小 < 2MB
  - ✅ 有动画
  - ✅ 显示正常

#### 步骤 5: 更新动画映射

编辑 `lib/3d/animationController.ts`（第 114-136 行）：

```typescript
const mapping: Record<AnimationState, string[]> = {
  idle: ['idle', 'Idle', 'Standing', 'YourIdleAnimationName'],
  paying: ['paying', 'Wave', 'ThumbsUp', 'YourPayAnimationName'],
  working: ['working', 'Walking', 'Typing', 'YourWorkAnimationName'],
  celebrating: ['celebrating', 'Dance', 'Jump', 'YourCelebrateAnimationName'],
};
```

## 🎨 自定义背景

### 改变背景颜色

编辑 `lib/3d/sceneManager.ts`（第 28 行）：

```typescript
// 当前：深蓝灰色
this.scene.background = new THREE.Color(0x1a1a2e);

// 选项 1: 纯黑色
this.scene.background = new THREE.Color(0x000000);

// 选项 2: 深蓝色（科技感）
this.scene.background = new THREE.Color(0x0a1929);

// 选项 3: 深紫色（未来感）
this.scene.background = new THREE.Color(0x1a0033);

// 选项 4: 渐变（需要更多代码）
// 使用 shader 或 CSS 渐变覆盖
```

### 添加星空背景

```typescript
// 在 sceneManager.ts 的 constructor 中添加
const starGeometry = new THREE.BufferGeometry();
const starMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.1,
  transparent: true,
});

const starVertices = [];
for (let i = 0; i < 1000; i++) {
  const x = (Math.random() - 0.5) * 200;
  const y = (Math.random() - 0.5) * 200;
  const z = (Math.random() - 0.5) * 200;
  starVertices.push(x, y, z);
}

starGeometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(starVertices, 3)
);

const stars = new THREE.Points(starGeometry, starMaterial);
this.scene.add(stars);
```

### 添加地板/平台

```typescript
// 在 sceneManager.ts 的 setupLighting() 后添加
const floorGeometry = new THREE.CircleGeometry(15, 32);
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x222222,
  metalness: 0.5,
  roughness: 0.5,
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.5;
floor.receiveShadow = true;
this.scene.add(floor);
```

### 改变光照

编辑 `lib/3d/sceneManager.ts`（第 73-106 行）：

```typescript
// 环境光强度（整体亮度）
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // 0.6 → 0.8 更亮

// 主光源颜色
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // 0.8 → 1.0

// 点光源颜色（氛围光）
const pointLight1 = new THREE.PointLight(0x00ffff, 0.8, 50); // 蓝色更强
const pointLight2 = new THREE.PointLight(0xff6600, 0.8, 50); // 橙色更强
```

## 🎬 推荐的模型组合

### 组合 1: 简约科技风

**Buyer (蓝色)**:
- 模型: Low Poly Robot（简约）
- 颜色: 亮蓝色材质
- 动画: 简单干净

**Seller (橙色)**:
- 模型: Low Poly Robot（同款）
- 颜色: 橙色材质
- 动画: 专业稳重

**背景**: 深蓝色 + 网格地板

### 组合 2: 可爱卡通风

**Buyer (蓝色)**:
- 模型: Cute Robot（圆润）
- 风格: Q版、大眼睛
- 动画: 活泼跳跃

**Seller (橙色)**:
- 模型: Cute Robot（同款）
- 风格: 稍微严肃
- 动画: 专业但友好

**背景**: 浅色 + 星空

### 组合 3: 专业商务风

**Buyer**:
- 模型: 商务机器人
- 风格: 西装领带
- 颜色: 深蓝色

**Seller**:
- 模型: 服务机器人
- 风格: 专业制服
- 颜色: 专业橙

**背景**: 暗色 + 聚光灯

## 🚀 快速测试新模型

1. **替换模型文件**
   ```bash
   cp new-buyer.glb public/models/buyer.glb
   cp new-seller.glb public/models/seller.glb
   ```

2. **清除缓存**
   ```bash
   rm -rf .next
   ```

3. **重启服务器**
   ```bash
   npm run dev
   ```

4. **刷新浏览器**
   - Ctrl+Shift+R 强制刷新

## 💡 我的建议

### 如果你想要快速升级（今天就能用）

告诉我：
1. **风格偏好**: 可爱 / 专业 / 科技 / 简约
2. **颜色偏好**: 具体的蓝色和橙色色号
3. **预算**: 免费 / 小预算 ($50) / 定制 ($100+)

我可以帮你：
- 找到合适的免费模型
- 下载并优化
- 配置到项目中
- 调整背景和光照

### 如果你想要专业定制（1-2周）

我可以帮你：
- 撰写需求文档
- 在 Fiverr 找设计师
- 审核设计稿
- 集成到项目

## 📞 下一步

**选项 1: 我帮你找模型**
→ 告诉我你喜欢的风格，我去找

**选项 2: 你给我链接**
→ 你在 Sketchfab 找到喜欢的，发给我

**选项 3: 我们一起调整背景**
→ 告诉我想要什么样的背景效果

---

**我的推荐**: 从 Sketchfab 免费模型开始，找到风格后再考虑定制！
