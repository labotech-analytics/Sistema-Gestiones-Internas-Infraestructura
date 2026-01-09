from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import me, gestiones, catalogos, usuarios

app = FastAPI(title="Infra Gestión API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500", "http://127.0.0.1:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(me.router)
app.include_router(catalogos.router)
app.include_router(gestiones.router)
app.include_router(usuarios.router)
