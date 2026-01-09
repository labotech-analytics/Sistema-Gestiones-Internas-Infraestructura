from fastapi import APIRouter, Depends
from ..auth import require_user

router = APIRouter(prefix="/me", tags=["me"])

@router.get("")
def me_endpoint(user=Depends(require_user)):
    return user
