# Juntos para iPhone y iPad

App nativa (Expo / React Native) de **Juntos**: ver videos sincronizados con amigos, con chat y voz.
La app muestra el servidor de Juntos a pantalla completa y agrega lo que una página sola no puede hacer en iPhone:

- micrófono para el chat de voz, sonido aunque el teléfono esté en silencio y por la bocina;
- **navegador integrado dentro de la sala**: YouTube completo (calidad, idioma del audio y subtítulos),
  servicios con tu propia cuenta y cualquier página con video, sincronizados con la sala.

El servidor de Juntos no está en este repositorio.

## Compilar

Se compila en una Mac de GitHub Actions y se sube a TestFlight (ver `.github/workflows/juntos-ios.yml`).
Las llaves de firma van como secretos del repositorio; nunca en el código.

```
git commit --allow-empty -m "Compilar [compilar]" && git push
```
