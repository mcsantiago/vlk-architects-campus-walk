# Campus Walk — Sample Data

Optional starter data for the Campus Walk take-home. All names, places and equipment details are fictional.

Use as much or as little of it as you like. Reshape it to fit your own data model; the structure here is a starting point, not a required schema.

## What's included

**Cedar Ridge ISD**, a fictional school district with two campuses that were partway through a campus walk in September 2026.

| Campus | Buildings | Rooms | Walk status |
| --- | --- | --- | --- |
| Bluebonnet Elementary (C-100) | 3 | 48 | Nearly complete; the portable hasn't been walked |
| Cedar Ridge High School (C-200) | 4 | 129 | In progress; Field House not started |

Total: 7 buildings, 10 floors, 177 rooms, about 840 asset records representing roughly 4,900 individual items.

## Files

| File | Description |
| --- | --- |
| `campuses.csv` | Campuses in the district |
| `buildings.csv` | Buildings per campus, with year built and gross square footage |
| `floors.csv` | Floors per building |
| `rooms.csv` | Rooms with type, area and `walked_on` (blank if not yet walked) |
| `asset_types.csv` | Asset catalog by category, with typical useful life |
| `assets.csv` | Asset inventory (see notes below) |
| `condition_scale.csv` | 1–5 condition rating definitions |
| `campus_walk_sample.json` | The same data as one nested JSON document |

## Notes on the asset data

- **Building-level assets** (rooftop HVAC units, roofs, boilers, electrical panels) have a `building_id` but no `floor_id` or `room_id`.
- **Bulk furniture** (desks, chairs, tables) is recorded as one row with a `quantity`. Individually tracked equipment has a `quantity` of 1 and an `asset_tag`. The same room may have two rows for the same furniture type when items were bought in different years.
- **Unassessed assets** have a blank `condition_rating`, `last_assessed_on` and `assessed_by`. These are in rooms that haven't been walked yet.
- **Unassigned assets:** a few newly delivered items have a campus and building but no room yet.
- `condition_rating` uses the 1–5 scale in `condition_scale.csv` (1 = Critical, 5 = Excellent).

No photos are included. Use placeholder images or your own.
