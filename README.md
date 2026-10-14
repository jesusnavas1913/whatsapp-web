# 📱 WhatsApp Web - Clon en Tiempo Real con Inicio de Sesión por Celular

Una réplica moderna, ultrarrápida y completa de **WhatsApp Web**, desarrollada con HTML5, CSS3 y JavaScript moderno, con soporte para comunicación en tiempo real y autenticación por número telefónico.

---

## ✨ Características Principales

- 📱 **Inicio de Sesión y Registro por Número de Celular**:
  - Selector de país internacional (`+57`, `+52`, `+34`, `+54`, `+51`, `+1`, etc.).
  - Simulación interactiva de código de verificación por SMS de 6 dígitos con autocompletado.
  - Creación de cuenta y perfil personalizado para números nuevos.
  - Cuentas de acceso rápido para pruebas inmediatas con 1 clic.
- 💬 **Comunicación Directa por Número Móvil**:
  - Inicia chats ingresando directamente el número de WhatsApp de cualquier persona.
  - Sincronización instantánea de mensajes en tiempo real entre números de teléfono.
- 🎙️ **Notas de Voz Reales**:
  - Grabación con micrófono real mediante la API `MediaRecorder` con cronómetro y botón de descartar/enviar.
  - Reproductor con ondas animadas en las burbujas de chat y selector de velocidad (`1x`, `1.5x`, `2x`).
- 📷 **Fotos y Archivos**:
  - Envío de imágenes con previsualización antes de enviar.
  - Visor Lightbox a pantalla completa al hacer clic en fotos.
- ⚡ **Funciones Oficiales de WhatsApp**:
  - Doble check gris (entregado) y azul (leído).
  - Reacciones a mensajes con emojis (❤️, 👍, 😂, 😮, 😢, 🙏).
  - Responder citando mensajes anteriores con barra de color.
  - Editar mensajes enviados y eliminar para todos.
  - Marcar mensajes como destacados (★).
- 🌐 **Estados / Historias**:
  - Visor de estados de WhatsApp con barra de progreso de 5 segundos.
- 📞 **Llamadas de Voz y Video**:
  - Simulación de llamadas y videollamadas con sonido de timbrado y cronómetro de duración.
- 🌗 **Tema Oscuro y Claro**:
  - Colores oficiales de WhatsApp Web con fondo de patrón doodle.

---

## 🚀 Cómo Ejecutar el Proyecto

### Opción 1: Directo en el Navegador (Sin dependencias)
1. Abre el archivo `index.html` en tu navegador favorito (Chrome, Edge, Firefox, Brave, etc.).
2. ¡Listo! Puedes abrir una segunda pestaña o ventana y chatear entre números en tiempo real gracias a `BroadcastChannel`.

### Opción 2: Con Servidor Node.js (Para chatear entre Celular y PC en la misma red WiFi)
1. Ejecuta el archivo `iniciar.bat` (o corre `node server.js` en tu terminal).
2. Abre la dirección `http://localhost:3000` en tu PC o la dirección IP local mostrada en consola desde tu celular conectado al mismo WiFi.
