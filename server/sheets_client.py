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
        # Apps Script Web Apps unconditionally 302-redirect every request
        # (GET and POST alike) to a signed script.googleusercontent.com URL —
        # httpx does not follow redirects by default, so without this every
        # call here would either see the bare 302 or lose the POST body.
        self._client = client or httpx.AsyncClient(timeout=30.0, follow_redirects=True)

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
        """Mirrors DripIT's own in-app numbering (computeNextNumber in
        src/App.jsx): scan existing orders for the highest `<prefix>-####`
        already used, and take the next one, zero-padded to 4 digits — rather
        than trusting the Sheet's `counters` tab, which the React app has never
        actually kept in sync with an `orderSeq` field.
        """
        prefix = "NV" if brand == "NOVUS" else "DI"
        needle = f"{prefix}-"
        rows = await self.list_rows("orders")
        max_seq = 0
        for row in rows:
            order_number = row.get("orderNumber") or ""
            if order_number.startswith(needle):
                suffix = order_number[len(needle):]
                if suffix.isdigit():
                    max_seq = max(max_seq, int(suffix))
        return f"{prefix}-{max_seq + 1:04d}"
