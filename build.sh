cd DipReader
docker run --rm \
 -v $(pwd):/project \
 -v ~/.cache/electron:/root/.cache/electron \
 -v ~/.cache/electron-builder:/root/.cache/electron-builder \
 electronuserland/builder:wine \
 /bin/bash -c "rm -rf node_modules && npm install --platform=win32 --arch=x64 && npm run dist -- --win --x64"