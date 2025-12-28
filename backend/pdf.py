import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from .auth import _extract_bearer_token, _get_current_user
from .models import UserPublic
from .state import _parse_date_input

router = APIRouter()

FRONTEND_BASE_URL = (
    os.environ.get("FRONTEND_BASE_URL")
    or os.environ.get("APP_ORIGIN")
    or "http://localhost:5173"
).strip()


@router.get("/v1/pdf/week")
def export_week_pdf(
    start: str = Query(..., min_length=8),
    authorization: Optional[str] = Header(default=None),
    current_user: UserPublic = Depends(_get_current_user),
):
    _ = current_user
    start_iso = _parse_date_input(start)
    if not start_iso:
        raise HTTPException(status_code=400, detail="Start date required.")
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token.")
    base_url = FRONTEND_BASE_URL.rstrip("/")
    print_url = f"{base_url}/print/week?start={start_iso}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 1400, "height": 900})
                page.add_init_script(
                    "localStorage.setItem('authToken', %s);" % json.dumps(token)
                )
                page.goto(print_url, wait_until="networkidle", timeout=20000)
                page.wait_for_function("window.__PDF_READY__ === true", timeout=20000)
                page.emulate_media(media="print")
                dims = page.evaluate(
                    """() => {
                        const body = document.body;
                        const html = document.documentElement;
                        return {
                            width: Math.max(body.scrollWidth, html.scrollWidth),
                            height: Math.max(body.scrollHeight, html.scrollHeight),
                        };
                    }"""
                )
                width = float(dims.get("width", 0) or 0)
                height = float(dims.get("height", 0) or 0)
                dpi = 96.0
                a4_width = 11.69 * dpi
                a4_height = 8.27 * dpi
                margin = (10 / 25.4) * dpi
                usable_width = max(1.0, a4_width - (2 * margin))
                usable_height = max(1.0, a4_height - (2 * margin))
                scale = 1.0
                if width > 0 and height > 0:
                    scale = min(1.0, usable_width / width, usable_height / height)
                pdf_bytes = page.pdf(
                    format="A4",
                    landscape=True,
                    print_background=True,
                    scale=scale,
                    margin={"top": "10mm", "right": "10mm", "bottom": "10mm", "left": "10mm"},
                )
            finally:
                browser.close()
    except PlaywrightTimeoutError as exc:
        raise HTTPException(status_code=504, detail="PDF render timed out.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="PDF render failed.") from exc

    filename = f"shift-planner-{start_iso}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/v1/pdf/weeks")
def export_weeks_pdf(
    start: str = Query(..., min_length=8),
    weeks: int = Query(..., ge=1, le=55),
    authorization: Optional[str] = Header(default=None),
    current_user: UserPublic = Depends(_get_current_user),
):
    _ = current_user
    start_iso = _parse_date_input(start)
    if not start_iso:
        raise HTTPException(status_code=400, detail="Start date required.")
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token.")
    base_url = FRONTEND_BASE_URL.rstrip("/")
    print_url = f"{base_url}/print/weeks?start={start_iso}&weeks={weeks}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 1400, "height": 900})
                page.add_init_script(
                    "localStorage.setItem('authToken', %s);" % json.dumps(token)
                )
                page.goto(print_url, wait_until="networkidle", timeout=20000)
                page.wait_for_function("window.__PDF_READY__ === true", timeout=20000)
                page.emulate_media(media="print")
                dims = page.evaluate(
                    """() => {
                        const body = document.body;
                        const html = document.documentElement;
                        return {
                            width: Math.max(body.scrollWidth, html.scrollWidth),
                            height: Math.max(body.scrollHeight, html.scrollHeight),
                        };
                    }"""
                )
                width = float(dims.get("width", 0) or 0)
                dpi = 96.0
                a4_width = 11.69 * dpi
                margin = (10 / 25.4) * dpi
                usable_width = max(1.0, a4_width - (2 * margin))
                scale = 1.0
                if width > 0:
                    scale = min(1.0, usable_width / width)
                pdf_bytes = page.pdf(
                    format="A4",
                    landscape=True,
                    print_background=True,
                    scale=scale,
                    margin={
                        "top": "10mm",
                        "right": "10mm",
                        "bottom": "10mm",
                        "left": "10mm",
                    },
                )
            finally:
                browser.close()
    except PlaywrightTimeoutError as exc:
        raise HTTPException(status_code=504, detail="PDF render timed out.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="PDF render failed.") from exc

    filename = f"shift-planner-{start_iso}-{weeks}w.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
