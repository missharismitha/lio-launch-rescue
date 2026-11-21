# Transport comparison and freight estimates

Code: `app/freight.py` (pure functions, no network, no model). Tests: `tests/test_freight.py`.
Surfaces: crew result key `transport`, public issue detail key `transport`, read-only agent tool `compare_transport`.

## What is data, what is estimate, what is assumption

| Item | Kind | Where it comes from |
|---|---|---|
| Suppliers of the material, their country | Customer data | supplier `components.csv` and `profile.csv`, purchase orders |
| Origin port or airport | Customer data (rule below) | `open_shipments.csv`, `ports.csv` |
| Route legs and transit days | Customer data | `master/routes.csv` |
| Deadline | Customer data, computed | last packing moment from the packing plan (`pricing.last_packing_moment`); fallback: launch date in `products.csv` at 20:00 |
| Handling days | Assumption | below |
| Packed weight per unit | Assumption | below; part weights are NOT in the customer data |
| Freight rates | Market figure or assumption | below; the customer data holds NO freight price |
| Delivered-versus-FOB price gap | Computed from customer data | purchase orders; a rough bound, not a rate |

Every cost shown is an estimate. `transport.estimate` is always true. An unknown weight gives cost `null`, never zero.
A supplier inquiry is not a confirmed shipment: "feasible" means the transit time fits before the deadline, not that stock exists or a slot is booked.

## Method

1. Lanes: one per supplier of the issue's material (supplier folders and POs; nothing hardcoded). Quantity = the shortage.
2. Origin rule: for each mode, the origin used by that supplier's own rows in `open_shipments.csv` (most frequent); if the supplier has no shipment in that mode, the first port or airport of that mode in the supplier's country that has a route to the DC. The basis text says when the country fallback was used.
3. Route: cheapest chain of `routes.csv` legs from the origin to `DC-HAM` (up to 3 legs), for example Incheon > Frankfurt > Hamburg DC. A mode appears only if such a chain exists. `via` (a transshipment port) adds no days beyond the listed transit days.
4. Time: arrival = as-of (board time) + chain transit days + handling days. Margin hours = deadline - arrival (negative = too late).
5. Handling days (assumptions, key `handling_days`): air 1 day first mile + 1 day customs and handling; sea 3 days port and customs; road 0.
6. Cost = chargeable kg x rate x FX, plus trucking to the DC when the chain ends in a road leg after a port or airport.
   Chargeable kg = quantity x unit weight x 1.3 packing factor (actual weight with an allowance, not a volumetric calculation).
7. Rank: among feasible modes, 1 = cheapest base cost (unknown cost sorts last). `fastest` = earliest arrival of any mode; `cheapest_feasible` = rank 1 among costed feasible modes, else null.
8. If no mode is feasible for a lane, the lane says so (`cheapest_feasible` null, every verdict "Too late by ..."). That is a result, not an error.

## Rates (USD per kg unless stated; low / base / high)

| Rate | Low | Base | High | Source and period |
|---|---|---|---|---|
| Air, global average (also used for Asia to Europe: no reliable per-kg figure found for Nov 2026) | 3.11 | 3.45 | 5.175 | Base: WorldACD weekly air cargo trends, week 45, 2-8 Nov 2026 (https://www.ajot.com/news/worldacd-weekly-air-cargo-trends-week-45-2026). Low: Xeneta global spot, October 2026. High = base x 1.5, a stress buffer for urgent small lots: our assumption, not market data |
| Air, North America to Europe (US, CA, MX origins) | 1.15 | 1.15 | 2.875 | Low and base: Xeneta backhaul corridor, October 2026. High = base x 2.5, stress buffer for urgent lots: our assumption, not market data |
| Sea | = base | 0.1748 | base x 1.5 | ShipUniverse summary of Drewry World Container Index, Shanghai to Rotterdam, 19 Nov 2026 (secondary source; exact week not independently verified): USD 3,496 per 40 ft, divided by an assumed 20,000 kg payload (assumption). Comparison only; sea is not feasible for this launch. Port, customs and local trucking charges are not included. The same figure is used for every sea origin (a proxy) |
| Road (EUR per kg) | 0.10 | 0.15 | 0.25 | Our assumption for Poznan to Hamburg, no market source; confirm with Soony logistics |
| Trucking port or airport to DC (EUR per kg) | | 0.05 | | Our assumption (for example Frankfurt to Hamburg); confirm with Soony logistics |
| FX | | 1 EUR = 1.0989 USD, so USD to EUR 0.9100 | | ECB reference rate 17 Nov 2026 via Banca d'Italia. If `fx_to_eur.USD` is set in assumptions.json it is used instead |

## Unit weights (assumptions, kg per packed unit, incl. packaging)

Matched by keyword against the component description and category, first match wins: steel case 0.3; art book (96 p hardcover) 0.7; poster 0.08; statue (die-cast 18 cm) 0.9; collector's box 0.4; sleeve 0.005; leaflet 0.005; case 0.06; game card 0.02. No match (for example magnets) means weight unknown and no cost.

## Historical cross-check

From the current and the legacy purchase orders (legacy rows carry no currency or term: both come from the supplier profile; legacy prices use a decimal comma). For the issue's material, the median unit price on delivered terms (DDP, DAP, ...) is compared with the median on FOB, EXW or FCA terms in the same currency. Result: `delivered_premium_pct`, the per-unit gap in EUR, and whether the highest base estimate per unit is below that gap (`estimate_within_premium`). The two prices come from different suppliers, so the gap is a rough upper bound on freight plus duty plus margin, not a freight rate. If the material was not bought on both term types, the check says so and returns null.

## Use in options and pricing

Option pricing never fills an unknown freight rate silently. `pricing.price_option` uses the estimate only when the option carries a per-unit estimate and assumptions.json has `"use_freight_estimates": true`. Then the option has `price_basis: "estimate"`, the note "Estimated from market rate ...; to be confirmed", and the approver is marked provisional. A rate set by hand in `freight_eur_per_unit_by_mode` always wins. Approver routing (PP-07 air-freight tiers, monthly limit, CPO) is unchanged and runs on the estimated freight value; the real tier follows the confirmed quote. The comparison table itself is always shown with estimates. Rule-based recovery options use the fastest feasible mode of the supplier's lane (fastest overall if none is feasible, air if the lane is unknown).

## How to override

Edit `.local/assumptions.json` (ignored by git). Everything is optional and deep-merged over the defaults in `freight.DEFAULTS`:

```json
{
  "use_freight_estimates": true,
  "fx_to_eur": {"USD": 0.91},
  "freight_estimate": {
    "usd_to_eur": 0.91,
    "packing_factor": 1.3,
    "air_rates_usd_per_kg": {"global": {"low": 3.0, "base": 3.5, "high": 5.0}},
    "road_eur_per_kg": {"low": 0.1, "base": 0.15, "high": 0.25},
    "onward_truck_eur_per_kg": {"value": 0.05},
    "sea_usd_per_40ft": {"value": 3496},
    "sea_payload_kg_per_40ft": 20000,
    "handling_days": {"air": {"first_mile": 1, "customs_handling": 1}, "sea": {"port_customs": 3}},
    "weights_kg_by_material": {"<component id>": 0.02}
  }
}
```

`weights_kg` (the keyword list) can also be replaced as a whole. Precedence for USD to EUR: `freight_estimate.usd_to_eur`, then `fx_to_eur.USD`, then the ECB default.
