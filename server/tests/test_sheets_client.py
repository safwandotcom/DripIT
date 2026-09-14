import json

import httpx
import pytest
import respx

from sheets_client import SheetsClient, SheetsError

URL = "https://script.google.com/macros/s/test/exec"


def test_default_client_follows_redirects():
    # Apps Script Web Apps always 302-redirect every request (GET and POST)
    # to a signed script.googleusercontent.com URL. httpx does not follow
    # redirects by default — without this, every real call would see a bare
    # 302 (GET) or silently lose its body (POST). Confirmed against a real
    # deployed Apps Script during rollout.
    client = SheetsClient(URL)
    assert client._client.follow_redirects is True


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
async def test_next_order_number_scans_existing_orders_for_max_and_pads():
    respx.get(URL, params={"action": "list", "entity": "orders"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": [
            {"orderNumber": "DI-0001", "company": "drip_ittt"},
            {"orderNumber": "DI-0041", "company": "drip_ittt"},
            {"orderNumber": "NV-0099", "company": "NOVUS"},
        ]})
    )
    assert await SheetsClient(URL).next_order_number("drip_ittt") == "DI-0042"


@respx.mock
async def test_next_order_number_starts_at_0001_for_brand_with_no_orders():
    respx.get(URL, params={"action": "list", "entity": "orders"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": []})
    )
    assert await SheetsClient(URL).next_order_number("NOVUS") == "NV-0001"


@respx.mock
async def test_next_order_number_ignores_malformed_order_numbers():
    respx.get(URL, params={"action": "list", "entity": "orders"}).mock(
        return_value=httpx.Response(200, json={"ok": True, "data": [
            {"orderNumber": "DI-abc", "company": "drip_ittt"},
            {"orderNumber": None, "company": "drip_ittt"},
            {"orderNumber": "DI-0005", "company": "drip_ittt"},
        ]})
    )
    assert await SheetsClient(URL).next_order_number("drip_ittt") == "DI-0006"
