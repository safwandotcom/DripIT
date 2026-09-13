import json

import httpx
import pytest
import respx

from sheets_client import SheetsClient, SheetsError

URL = "https://script.google.com/macros/s/test/exec"


@respx.mock
async def test_list_rows_returns_data_on_success():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": [{"id": "d1"}]})
    )
    rows = await SheetsClient(URL).list_rows("pendingDeals")
    assert rows == [{"id": "d1"}]


@respx.mock
async def test_list_rows_raises_on_ok_false():
    respx.get(URL, params={"action": "list", "entity": "orders"}).mock(
        return_value=httpx.Response(200, json={"ok": False, "error": "boom"})
    )
    with pytest.raises(SheetsError):
        await SheetsClient(URL).list_rows("orders")


@respx.mock
async def test_get_pending_deal_finds_matching_row():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(
            200, json={"ok": True, "data": [{"id": "d1", "title": "A"}, {"id": "d2", "title": "B"}]}
        )
    )
    row = await SheetsClient(URL).get_pending_deal("d2")
    assert row == {"id": "d2", "title": "B"}


@respx.mock
async def test_get_pending_deal_returns_none_when_missing():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    assert await SheetsClient(URL).get_pending_deal("missing") is None


@respx.mock
async def test_update_pending_deal_merges_and_saves_full_row():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(
            200, json={"ok": True, "data": [{"id": "d1", "title": "A", "status": "awaiting_review"}]}
        )
    )
    save_route = respx.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    merged = await SheetsClient(URL).update_pending_deal(
        "d1", status="awaiting_price", pending_action="postonly"
    )

    assert merged == {
        "id": "d1", "title": "A", "status": "awaiting_price", "pending_action": "postonly"
    }
    sent = json.loads(save_route.calls.last.request.content)
    assert sent["entity"] == "pendingDeals"
    assert sent["data"]["title"] == "A"  # untouched field preserved, not dropped
    assert sent["data"]["status"] == "awaiting_price"


@respx.mock
async def test_update_pending_deal_raises_when_not_found():
    respx.get(URL, params={"action": "list", "entity": "pendingDeals"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    with pytest.raises(SheetsError):
        await SheetsClient(URL).update_pending_deal("missing", status="rejected")


@respx.mock
async def test_next_order_number_increments_existing_counter():
    respx.get(URL, params={"action": "list", "entity": "counters"}).mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "data": [{"id": "drip_ittt", "orderSeq": 41, "invoiceSeq": 10, "receiptSeq": 5}]},
        )
    )
    save_route = respx.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    number = await SheetsClient(URL).next_order_number("drip_ittt")

    assert number == "DI-42"
    sent = json.loads(save_route.calls.last.request.content)
    assert sent["data"]["orderSeq"] == 42
    assert sent["data"]["invoiceSeq"] == 10  # other counters preserved


@respx.mock
async def test_next_order_number_starts_at_one_for_new_brand():
    respx.get(URL, params={"action": "list", "entity": "counters"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    respx.post(URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    assert await SheetsClient(URL).next_order_number("NOVUS") == "NV-1"
