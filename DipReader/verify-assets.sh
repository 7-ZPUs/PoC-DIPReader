#!/bin/bash
# verify-assets.sh - Verify that all required assets are in place

echo "🔍 Verifying DipReader Assets Configuration..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

errors=0
warnings=0

# Check source files
echo "📂 Source Files:"
if [ -f "schema.sql" ]; then
  size=$(stat -f%z "schema.sql" 2>/dev/null || stat -c%s "schema.sql" 2>/dev/null)
  echo -e "  ${GREEN}✓${NC} schema.sql (${size} bytes) - Node.js only"
else
  echo -e "  ${RED}✗${NC} schema.sql - MISSING!"
  ((errors++))
fi

if [ -f "src/assets/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx" ]; then
  size=$(stat -f%z "src/assets/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx" 2>/dev/null || stat -c%s "src/assets/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx" 2>/dev/null)
  size_mb=$((size / 1024 / 1024))
  echo -e "  ${GREEN}✓${NC} ONNX model (${size_mb}MB)"
else
  echo -e "  ${RED}✗${NC} ONNX model - MISSING!"
  ((errors++))
fi

# Check required config files
required_files=(
  "src/assets/models/Xenova/all-MiniLM-L6-v2/config.json"
  "src/assets/models/Xenova/all-MiniLM-L6-v2/tokenizer.json"
  "src/assets/models/Xenova/all-MiniLM-L6-v2/tokenizer_config.json"
)

for file in "${required_files[@]}"; do
  if [ -f "$file" ]; then
    echo -e "  ${GREEN}✓${NC} $(basename $file)"
  else
    echo -e "  ${RED}✗${NC} $file - MISSING!"
    ((errors++))
  fi
done

echo ""

# Check dist files (if built)
echo "📦 Build Output (dist):"
if [ -d "dist/DipReader/browser" ]; then
  # Note: schema.sql is NOT needed in dist/browser - it's packaged separately by electron-builder
  # db-handler.js reads it directly from public/schema.sql
  
  if [ -f "dist/DipReader/browser/assets/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx" ]; then
    echo -e "  ${GREEN}✓${NC} ONNX model copied to dist"
  else
    echo -e "  ${YELLOW}⚠${NC} ONNX model not in dist (run 'ng build' first)"
    ((warnings++))
  fi
else
  echo -e "  ${YELLOW}⚠${NC} dist/ not found - run 'ng build' to verify build output"
  ((warnings++))
fi

echo ""

# Check package.json configuration
echo "⚙️  Configuration:"
if grep -q '"schema.sql"' package.json; then
  echo -e "  ${GREEN}✓${NC} electron-builder includes schema.sql"
else
  echo -e "  ${RED}✗${NC} schema.sql not in electron-builder files!"
  ((errors++))
fi

if grep -q '"from": "dist/DipReader/browser/assets/models"' package.json; then
  echo -e "  ${GREEN}✓${NC} electron-builder extraResources configured"
else
  echo -e "  ${RED}✗${NC} ONNX models not in electron-builder extraResources!"
  ((errors++))
fi

if grep -q '"input": "src/assets"' angular.json; then
  echo -e "  ${GREEN}✓${NC} Angular assets configuration (models only)"
else
  echo -e "  ${RED}✗${NC} Angular assets not configured!"
  ((errors++))
fi

# Verify public/ is NOT in angular.json (schema.sql is Node-only)
if ! grep -q '"input": "public"' angular.json; then
  echo -e "  ${GREEN}✓${NC} No public/ in Angular config (correct - Node.js handles schema.sql)"
else
  echo -e "  ${YELLOW}⚠${NC} public/ found in Angular config (unnecessary - schema.sql is Node-only)"
  ((warnings++))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
  echo -e "${GREEN}✅ All assets verified successfully!${NC}"
  exit 0
elif [ $errors -eq 0 ]; then
  echo -e "${YELLOW}⚠️  Verification passed with $warnings warning(s)${NC}"
  echo "Run 'ng build' to verify build output"
  exit 0
else
  echo -e "${RED}❌ Verification failed with $errors error(s) and $warnings warning(s)${NC}"
  echo ""
  echo "Fix errors and run verification again"
  exit 1
fi
