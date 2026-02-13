# DipReader Assets Organization

## 📁 Directory Structure

```
DipReader/
├── schema.sql                    ← Node.js database schema (Main Process)
├── main.js                       ← Electron main process
├── db-handler.js                 ← Database handler (reads schema.sql)
├── ai-search.js                  ← AI semantic search
├── indexer-main.js              ← Document indexer
├── preload.js                   ← Electron preload script
│
└── src/
    └── assets/
        └── models/              ← AI models (Angular → dist → packaged)
            └── Xenova/
                └── all-MiniLM-L6-v2/
                    ├── config.json
                    ├── tokenizer_config.json
                    ├── tokenizer.json
                    └── onnx/
                        └── model_quantized.onnx  (21MB)
```

## 🎯 Separation of Concerns

### ✅ Correct Organization

| Asset | Location | Used By | Processed By | Reason |
|-------|----------|---------|--------------|--------|
| `schema.sql` | Root | Node.js | electron-builder | Database schema, Node-only |
| AI models | `src/assets/` | Node.js* | Angular + electron-builder | Large files, needs Angular build |
| Images, CSS | `src/assets/` | Angular | Angular | Renderer process assets |

*Node.js accesses models via filesystem after Angular builds them to dist/

### ❌ What We Fixed

**Before** (incorrect):
```
public/schema.sql  ← Node.js asset in Angular's public/ folder ❌
```
- `public/` is an Angular convention for static assets
- Angular doesn't use `public/` in this project
- Mixing Node.js and Angular concerns

**After** (correct):
```
schema.sql         ← Node.js asset in root with other Node.js files ✅
```
- Clear separation: Node.js assets in root
- Angular assets in `src/assets/`
- No confusion about ownership

## 🔄 Build & Package Flow

### Development (`npm run electron:ubuntu`)

```
1. Angular Build
   └─ ng build
      └─ src/assets/models/ → dist/DipReader/browser/assets/models/

2. Electron Launch  
   └─ electron .
      ├─ main.js reads schema.sql from __dirname (root)
      └─ ai-search.js reads models from dist/DipReader/browser/assets/models/
```

### Production (`npm run dist`)

```
1. Angular Build (production)
   └─ ng build --configuration production
      └─ src/assets/models/ → dist/DipReader/browser/assets/models/

2. Electron Builder
   └─ electron-builder
      ├─ Packages schema.sql from root → app.asar
      ├─ Packages *.js files (main, db-handler, etc.) → app.asar
      └─ Copies AI models as extraResources → resources/assets/models/
         (unpackaged for native ONNX access)
```

## ⚙️ Configuration

### angular.json - Angular Assets Only

```json
"assets": [
  {
    "glob": "**/*",
    "input": "src/assets",
    "output": "/assets"
  }
]
```

**What changed**: Removed `public/` configuration
- `public/` was unused by Angular
- Only `src/assets/` contains Angular-relevant files

### package.json - Electron Builder

```json
"files": [
  "dist/DipReader/**/*",
  "main.js",
  "preload.js",
  "db-handler.js",
  "indexer-main.js",
  "ai-search.js",
  "package.json",
  "schema.sql"              ← Direct root reference
],
"extraResources": [
  {
    "from": "dist/DipReader/browser/assets/models",
    "to": "assets/models"
  }
]
```

**What changed**: `"public/schema.sql"` → `"schema.sql"`

### db-handler.js - Schema Loading

```javascript
createSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    // Backward compatibility
    const legacySchemaPath = path.join(__dirname, 'public', 'schema.sql');
    if (fs.existsSync(legacySchemaPath)) {
      // ... use legacy path
    }
    throw new Error('Schema file not found');
  }
  
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  this.db.exec(schema);
}
```

**What changed**: Primary path is now root, `public/` as fallback

## 🚀 Verification

Run the verification script:

```bash
./verify-assets.sh
```

**Expected output**:
```
✅ All assets verified successfully!
```

The script checks:
- ✅ `schema.sql` exists in root
- ✅ AI models exist in `src/assets/models/`
- ✅ `angular.json` has no `public/` reference
- ✅ `package.json` references `schema.sql` correctly
- ✅ Build output has models in correct location

## 📝 Summary

**Philosophy**: 
- **Root directory** = Node.js/Electron main process assets
- **src/assets/** = Angular renderer process assets (and large files accessed by Node)

**Benefits**:
1. Clear ownership and responsibility
2. No mixing of Angular and Node.js concerns
3. Simplified configuration (removed duplicate asset directive)
4. Better maintainability - easy to understand where assets belong
