# ⚽ Mirador II FC — Sitio Web del Equipo

Aplicación web completa para el equipo de fútbol **Mirador II**.  
Stack: **Python (FastAPI) + PostgreSQL (Supabase) + Render** — 100% gratuito.

---

## 🏗 Estructura del Proyecto

```
mirador-ii/
├── app/
│   ├── main.py          ← FastAPI: sirve la API y el frontend
│   ├── database.py      ← Conexión a PostgreSQL
│   ├── models.py        ← Tablas de la base de datos
│   ├── schemas.py       ← Validación de datos (Pydantic)
│   ├── auth.py          ← JWT y autenticación
│   └── routers/
│       ├── auth.py      ← Login, cambio de contraseña
│       ├── players.py   ← Jugadores (CRUD)
│       ├── matches.py   ← Partidos y goles (CRUD)
│       ├── votes.py     ← Votación MVP
│       └── payments.py  ← Registro de pagos
├── static/
│   ├── index.html       ← SPA Frontend
│   ├── style.css        ← Estilos (tema fútbol oscuro)
│   └── app.js           ← Lógica frontend completa
├── requirements.txt
├── render.yaml          ← Configuración de despliegue en Render
└── .env.example         ← Variables de entorno de ejemplo
```

---

## 🚀 Despliegue paso a paso (GRATIS)

### Paso 1 — Subir a GitHub

1. Crea una cuenta en [github.com](https://github.com) si no tienes.
2. Crea un repositorio nuevo: `mirador-ii` (privado o público).
3. Sube todos los archivos del proyecto.

```bash
# En PyCharm → Terminal
cd ruta/al/proyecto
git init
git add .
git commit -m "Primer commit - Mirador II FC"
git remote add origin https://github.com/TU_USUARIO/mirador-ii.git
git push -u origin main
```

---

### Paso 2 — Crear base de datos en Supabase

1. Ve a [supabase.com](https://supabase.com) → **New Project**
2. Nombre: `mirador-ii` | Contraseña: (guárdala bien)
3. Región: **South America (São Paulo)**
4. Espera ~2 minutos a que se cree.
5. Ve a **Settings → Database → Connection string → URI**
6. Copia la cadena que empieza con `postgresql://postgres:...`

---

### Paso 3 — Desplegar en Render

1. Ve a [render.com](https://render.com) → **New → Web Service**
2. Conecta tu repositorio de GitHub.
3. Configura:
   - **Name:** `mirador-ii`
   - **Environment:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. En **Environment Variables** añade:
   ```
   DATABASE_URL  → (URL de Supabase que copiaste)
   SECRET_KEY    → (cualquier texto largo y aleatorio)
   ADMIN_PASSWORD → (tu contraseña de admin, ej: MiradorII2024!)
   ```
5. Clic en **Create Web Service** → Render despliega (~5 min).

---

### Paso 4 — Crear el admin inicial

Una sola vez, abre en el navegador:
```
https://tu-app.onrender.com/api/auth/setup
```
Esto crea el usuario `admin` con la contraseña que pusiste en `ADMIN_PASSWORD`.

> ⚠️ Solo funciona una vez. Después retorna error "admin ya existe".

---

### Paso 5 — ¡Listo! 🎉

Tu sitio quedará en: `https://mirador-ii.onrender.com`  
(o el dominio que Render te asigne)

---

## 🔐 Uso del sistema

### Acceso público (sin login)
- Ver próximos partidos y último resultado
- Ver goleadores y asistencias
- Votar por el MVP del último partido (1 voto por IP por partido)
- Ver listado de jugadores (sin cédula)
- Ver resumen de pagos

### Acceso administrador
- URL: tu sitio → botón **"Iniciar sesión"**
- Usuario: `admin`
- Contraseña: la que configuraste en `ADMIN_PASSWORD`

Con acceso admin puedes:
- ✅ Agregar, editar y desactivar jugadores (ver cédula completa)
- ✅ Programar partidos (próximos)
- ✅ Registrar resultados, goles y asistencias
- ✅ Registrar pagos de inscripción y arbitraje por fase
- ✅ Eliminar registros incorrectos

---

## 🛠 Desarrollo local (PyCharm)

```bash
# 1. Crear entorno virtual
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Crear archivo .env (copiar .env.example)
cp .env.example .env
# Edita .env con tu DATABASE_URL de Supabase

# 4. Ejecutar
uvicorn app.main:app --reload

# 5. Abrir http://localhost:8000
```

### Documentación de la API
Disponible en: `http://localhost:8000/docs` (Swagger UI automático)

---

## 📊 Tablas de la base de datos

| Tabla      | Descripción                                  |
|------------|----------------------------------------------|
| `users`    | Usuarios administradores                     |
| `players`  | Jugadores con cédula, nombre, número, teléfono, salud |
| `matches`  | Partidos (próximos y jugados) con resultado  |
| `goals`    | Goles y asistencias por partido              |
| `votes`    | Votos MVP por partido (1 por IP)             |
| `payments` | Pagos de inscripción y arbitraje por jugador |

---

## 🔄 Actualizaciones futuras

Para hacer cambios:
1. Edita el código en PyCharm
2. `git add . && git commit -m "descripción" && git push`
3. Render detecta el push y redespliega automáticamente (~2 min)

---

## 📞 API Endpoints principales

```
GET  /api/matches              → Lista todos los partidos
POST /api/matches              → Crear partido (admin)
PUT  /api/matches/{id}         → Actualizar partido / resultado (admin)
POST /api/matches/{id}/votes   → Votar MVP (público)
GET  /api/matches/{id}/votes   → Ver resultados de votación
GET  /api/players              → Lista jugadores (cédula oculta)
POST /api/players              → Crear jugador (admin)
GET  /api/payments             → Resumen de pagos
POST /api/payments             → Registrar pago (admin)
POST /api/auth/login           → Iniciar sesión
```
