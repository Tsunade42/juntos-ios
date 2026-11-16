// Después de "expo prebuild --platform android": la versión de lanzamiento se firma con la llave propia de Juntos.
// La llave NO vive en este repositorio: se lee de un archivo de propiedades fuera de él
// (variable JUNTOS_FIRMA, o ../firma-android/juntos-firma.properties junto a esta carpeta).
const fs = require('fs'); const path = require('path');
const F = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let s = fs.readFileSync(F, 'utf8');
if (s.includes('signingConfigs.release')) { console.log('la firma ya estaba puesta'); process.exit(0); }
const release = `
        release {
            def p = new Properties()
            def f = file(System.getenv('JUNTOS_FIRMA') ?: '../../../firma-android/juntos-firma.properties')
            if (f.exists()) {
                f.withInputStream { p.load(it) }
                storeFile file(p['storeFile']); storePassword p['storePassword']; keyAlias p['keyAlias']; keyPassword p['keyPassword']
            }
        }`;
s = s.replace(/(signingConfigs \{\s*\n\s*debug \{[\s\S]*?\n\s*\})/, `$1${release}`);
s = s.replace(/(release \{\s*\n\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
if (!s.includes('signingConfig signingConfigs.release')) { console.error('No se pudo poner la firma'); process.exit(1); }
fs.writeFileSync(F, s);
console.log('firma de lanzamiento puesta');
