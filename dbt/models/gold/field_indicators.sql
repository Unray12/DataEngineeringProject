{{ config(materialized='table') }}

select
    field_id,
    farm_id,
    metric,
    day,
    min_value,
    max_value,
    avg_value,
    reading_count,
    valid_count,
    flagged_count,
    cast(valid_count * 100.0 / nullif(reading_count, 0) as double) as data_quality_pct,
    cast(flagged_count * 100.0 / nullif(reading_count, 0) as double) as flagged_pct
from {{ ref('field_daily') }}
