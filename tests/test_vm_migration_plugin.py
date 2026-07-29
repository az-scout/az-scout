"""Tests for the VM v6/v7 Migration internal plugin."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest  # noqa: F401

# ---------------------------------------------------------------------------
# Helper: ARM VM response factory
# ---------------------------------------------------------------------------


def _make_vm(
    name: str = "my-vm",
    sub_id: str = "sub-123",
    rg: str = "my-rg",
    size: str = "Standard_D4s_v3",
    location: str = "eastus",
    os_type: str = "Linux",
    publisher: str = "Canonical",
    img_sku: str = "20_04-lts",
    disk_controller: str = "SCSI",
    security_type: str = "",
    zones: list | None = None,
) -> dict:
    vm: dict = {
        "id": (
            f"/subscriptions/{sub_id}/resourceGroups/{rg}"
            f"/providers/Microsoft.Compute/virtualMachines/{name}"
        ),
        "name": name,
        "location": location,
        "zones": zones or [],
        "properties": {
            "hardwareProfile": {"vmSize": size},
            "storageProfile": {
                "imageReference": {
                    "publisher": publisher,
                    "offer": "UbuntuServer",
                    "sku": img_sku,
                },
                "osDisk": {
                    "osType": os_type,
                    "diskControllerType": disk_controller,
                },
            },
            "securityProfile": {},
        },
    }
    if security_type:
        vm["properties"]["securityProfile"]["securityType"] = security_type
    return vm


# ---------------------------------------------------------------------------
# Unit tests – migration candidate detection
# ---------------------------------------------------------------------------


class TestIsMigrationCandidate:
    """Validate _is_migration_candidate SKU filter."""

    @pytest.mark.parametrize(
        "sku,expected",
        [
            ("Standard_D4s_v3", True),
            ("Standard_E8ds_v4", True),
            ("Standard_D2s_v5", True),
            ("Standard_B2ms_v2", True),
            ("Standard_D4s_v6", False),
            ("Standard_D8s_v7", False),
            ("Standard_A2_v2", True),
            ("Standard_D16_v1", False),  # v1 is not in scope
            ("Standard_D4_v3_Promo", True),  # Promo suffix after version
            ("Standard_A1_v2_Promo", True),  # Promo on v2 family
            ("Standard_D4s_v6_Promo", False),  # v6 Promo is not in scope
        ],
    )
    def test_candidate_detection(self, sku: str, expected: bool) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _is_migration_candidate

        assert _is_migration_candidate(sku) == expected


# ---------------------------------------------------------------------------
# Unit tests – generation detection
# ---------------------------------------------------------------------------


class TestDetectGeneration:
    """Validate _detect_generation logic."""

    def test_trusted_launch_returns_v2(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _detect_generation

        vm = _make_vm(security_type="TrustedLaunch", size="Standard_D4s_v3")
        assert _detect_generation(vm) == "V2"

    def test_confidential_vm_returns_v2(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _detect_generation

        vm = _make_vm(security_type="ConfidentialVM", size="Standard_D4s_v3")
        assert _detect_generation(vm) == "V2"

    def test_gen2_image_sku_returns_v2(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _detect_generation

        vm = _make_vm(img_sku="2019-datacenter-gen2")
        assert _detect_generation(vm) == "V2"

    def test_v4_sku_infers_v2(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _detect_generation

        vm = _make_vm(size="Standard_E8ds_v4")
        assert _detect_generation(vm) == "V2 (inferred)"

    def test_v3_sku_infers_v1(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _detect_generation

        vm = _make_vm(size="Standard_D4s_v3")
        assert _detect_generation(vm) == "V1 (inferred)"

    def test_v2_sku_infers_v1(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _detect_generation

        vm = _make_vm(size="Standard_D2_v2")
        assert _detect_generation(vm) == "V1 (inferred)"


# ---------------------------------------------------------------------------
# Unit tests – resource group parsing
# ---------------------------------------------------------------------------


class TestParseResourceGroup:
    def test_extracts_rg_from_arm_id(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _parse_resource_group

        rid = (
            "/subscriptions/sub-abc/resourceGroups/my-rg"
            "/providers/Microsoft.Compute/virtualMachines/vm1"
        )
        assert _parse_resource_group(rid) == "my-rg"

    def test_case_insensitive(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _parse_resource_group

        rid = (
            "/subscriptions/sub-abc/RESOURCEGROUPS/MY-RG"
            "/providers/Microsoft.Compute/virtualMachines/vm1"
        )
        assert _parse_resource_group(rid) == "MY-RG"

    def test_empty_id_returns_empty(self) -> None:
        from az_scout.internal_plugins.vm_migration.routes import _parse_resource_group

        assert _parse_resource_group("") == ""


# ---------------------------------------------------------------------------
# Integration tests – API route
# ---------------------------------------------------------------------------


class TestGetMigrationVmsRoute:
    """Test the /vms API route via the FastAPI test client."""

    def test_missing_subscriptions_returns_400(self, client) -> None:
        resp = client.get("/api/vms")
        assert resp.status_code == 400
        assert "subscriptions" in resp.json()["error"]

    def test_empty_subscriptions_returns_400(self, client) -> None:
        resp = client.get("/api/vms?subscriptions=")
        assert resp.status_code == 400

    def test_returns_only_v2_to_v5_vms(self, client) -> None:
        """Only v2–v5 VMs should appear; v6/v7 VMs must be filtered out."""
        arm_vms = [
            _make_vm(name="vm-v3", size="Standard_D4s_v3"),
            _make_vm(name="vm-v5", size="Standard_D4s_v5"),
            _make_vm(name="vm-v6", size="Standard_D4s_v6"),  # must be excluded
        ]
        mock_resp = MagicMock(status_code=200, json=lambda: {"value": arm_vms})
        with (
            patch("az_scout.azure_api.requests.get", return_value=mock_resp),
            patch("az_scout.azure_api.list_subscriptions", return_value=[]),
        ):
            resp = client.get("/api/vms?subscriptions=sub-123")

        assert resp.status_code == 200
        names = [v["name"] for v in resp.json()]
        assert "vm-v3" in names
        assert "vm-v5" in names
        assert "vm-v6" not in names

    def test_response_schema(self, client) -> None:
        """Check that every required field is present in the response."""
        arm_vms = [_make_vm(zones=["1"])]
        mock_resp = MagicMock(status_code=200, json=lambda: {"value": arm_vms})
        with (
            patch("az_scout.azure_api.requests.get", return_value=mock_resp),
            patch("az_scout.azure_api.list_subscriptions", return_value=[]),
        ):
            resp = client.get("/api/vms?subscriptions=sub-123")

        assert resp.status_code == 200
        result = resp.json()
        assert len(result) == 1
        vm = result[0]
        for field in [
            "name",
            "resource_group",
            "subscription_id",
            "subscription_name",
            "region",
            "sku",
            "generation",
            "os_type",
            "image_publisher",
            "disk_controller_type",
            "zones",
        ]:
            assert field in vm, f"Missing field: {field}"

    def test_arm_authorization_error_skips_subscription(self, client) -> None:
        """403 errors on a subscription should not crash the whole request."""
        from az_scout.azure_api._arm import ArmAuthorizationError

        with (
            patch(
                "az_scout.azure_api.requests.get",
                side_effect=ArmAuthorizationError("Forbidden", status_code=403),
            ),
            patch("az_scout.azure_api.list_subscriptions", return_value=[]),
        ):
            resp = client.get("/api/vms?subscriptions=sub-403")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_subscription_name_resolved(self, client) -> None:
        """Subscription name should be resolved from list_subscriptions."""
        arm_vms = [_make_vm(name="vm1", sub_id="sub-abc")]
        mock_resp = MagicMock(status_code=200, json=lambda: {"value": arm_vms})
        with (
            patch("az_scout.azure_api.requests.get", return_value=mock_resp),
            patch(
                "az_scout.azure_api.list_subscriptions",
                return_value=[{"id": "sub-abc", "name": "My Production Sub"}],
            ),
        ):
            resp = client.get("/api/vms?subscriptions=sub-abc")

        assert resp.status_code == 200
        assert resp.json()[0]["subscription_name"] == "My Production Sub"

    def test_multi_subscription_aggregates_results(self, client) -> None:
        """Results from multiple subscriptions should be merged."""

        def side_effect(url, *, headers, params, timeout):
            sub_in_url = "sub-a" if "sub-a" in url else "sub-b"
            return MagicMock(
                status_code=200,
                json=lambda s=sub_in_url: {"value": [_make_vm(name=f"vm-{s}", sub_id=s)]},
            )

        with (
            patch("az_scout.azure_api.requests.get", side_effect=side_effect),
            patch("az_scout.azure_api.list_subscriptions", return_value=[]),
        ):
            resp = client.get("/api/vms?subscriptions=sub-a,sub-b")

        assert resp.status_code == 200
        names = {v["name"] for v in resp.json()}
        assert "vm-sub-a" in names
        assert "vm-sub-b" in names


# ---------------------------------------------------------------------------
# Plugin protocol tests
# ---------------------------------------------------------------------------


class TestVmMigrationPlugin:
    def test_plugin_protocol_surface(self) -> None:
        from az_scout.internal_plugins.vm_migration import plugin

        assert plugin.name == "vm-migration"
        assert plugin.version
        assert plugin.get_router() is not None
        assert plugin.get_static_dir() is not None
        tabs = plugin.get_tabs()
        assert tabs and len(tabs) == 1
        assert tabs[0].id == "vm-migration"
        tools = plugin.get_mcp_tools()
        assert tools and len(tools) == 1
        assert callable(tools[0])
