// Pone la firma manual (certificado de distribución + perfil de App Store) SOLO en la app, dentro del proyecto
// de Xcode que genera "expo prebuild". Las bibliotecas (Pods) se quedan sin firma, que es lo que Xcode espera.
// Uso: node scripts/firma.js "<nombre del perfil>" <equipo>
const fs = require('fs'); const path = require('path');
const [perfil, equipo] = process.argv.slice(2);
if (!perfil || !equipo) { console.error('Uso: node scripts/firma.js "<perfil>" <equipo>'); process.exit(1); }
const dir = fs.readdirSync('ios').find((d) => d.endsWith('.xcodeproj'));
const file = path.join('ios', dir, 'project.pbxproj');
let s = fs.readFileSync(file, 'utf8'); let n = 0;
// Cada configuración (Debug/Release) de la app tiene su identificador: ahí se agregan los ajustes de firma.
s = s.replace(/^(\s*)PRODUCT_BUNDLE_IDENTIFIER = "?com\.appr\.juntos"?;$/gm, (linea, sp) => {
  n++;
  return [linea,
    `${sp}CODE_SIGN_STYLE = Manual;`,
    `${sp}DEVELOPMENT_TEAM = ${equipo};`,
    `${sp}"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";`,
    `${sp}PROVISIONING_PROFILE_SPECIFIER = "${perfil.replace(/"/g, '')}";`].join('\n');
});
if (!n) { console.error('No se encontró la app en el proyecto de Xcode'); process.exit(1); }
// Quitar ajustes anteriores que choquen (los que pone prebuild por defecto)
s = s.replace(/^\s*CODE_SIGN_IDENTITY = "iPhone Developer";\n/gm, '');
fs.writeFileSync(file, s);
console.log('firma manual puesta en', n, 'configuraciones');
