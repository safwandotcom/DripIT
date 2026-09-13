"""Wrapper around the Google Apps Script Web App that DripIT already uses
as its Sheets sync backend. The Apps Script's `save` action REPLACES a row
by id rather than merging (see doPost in the generated script) — so every
partial update here does a read-merge-write instead of sending a bare
partial dict.
"""
from __future__ import annotations

import json

import httpx


class SheetsError(RuntimeError):
    """Raised when a Sheets request fails or the Apps Script reports ok=false."""


class SheetsClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None):
        self._url = base_url
        self._client = client or httpx.AsyncClient(timeout=30.0)

    async def list_rows(self, entity: str) -> list[dict]:
        response = await self._client.get(self._url, params={"action": "list", "entity": entity})
        body = self._parse(response)
        return body.get("data", [])

    async def save_row(self, entity: str, data: dict) -> None:
        # Sent as text/plain to avoid a CORS preflight, matching the app's
        # own sync mechanism — Apps Script reads e.postData.contents either way.
        response = await self._client.post(
            self._url,
            content=json.dumps({"action": "save", "entity": entity, "data": data}),
            headers={"Content-Type": "text/plain;charset=utf-8"},
        )
        self._parse(response)

    def _parse(self, response: httpx.Response) -> dict:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise SheetsError(f"Sheets request failed: {response.status_code}") from exc
        body = response.json()
        if not body.get("ok"):
            raise SheetsError(f"Sheets error: {body.get('error')}")
        return body

    async def get_pending_deal(self, deal_id: str) -> dict | None:
        for row in await self.list_rows("pendingDeals"):
            if str(row.get("id")) == str(deal_id):
                return row
        return None

    async def create_pending_deal(self, data: dict) -> None:
        await self.save_row("pendingDeals", data)

    async def update_pending_deal(self, deal_id: str, **changes) -> dict:
        current = await self.get_pending_deal(deal_id)
        if current is None:
            raise SheetsError(f"PendingDeal {deal_id} not found")
        merged = {**current, **changes}
        await self.save_row("pendingDeals", merged)
        return merged

    async def append_order(self, order: dict) -> None:
        await self.save_row("orders", order)

    async def next_order_number(self, brand: str) -> str:
        rows = await self.list_rows("counters")
        row = next((r for r in rows if str(r.get("id")) == brand), None)
        current_seq = int(row["orderSeq"]) if row and row.get("orderSeq") else 0
        next_seq = current_seq + 1
        await self.save_row("counters", {**(row or {"id": brand}), "orderSeq": next_seq})
        prefix = "NV" if brand == "NOVUS" else "DI"
        return f"{prefix}-{next_seq}"
