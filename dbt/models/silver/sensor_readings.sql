{{ config(materialized='table') }}

with ranked as (
    select
        *,
        row_number() over (
            partition by device_id, metric, measured_at
            order by ingested_at desc, source_offset desc
        ) as row_num
    from {{ source('bronze', 'sensor_readings') }}
    where measured_at is not null
      and device_id is not null
      and metric is not null
)
select
    event_id,
    device_id,
    field_id,
    farm_id,
    crop_code,
    metric,
    value,
    unit,
    measured_at,
    ingested_at,
    is_late,
    quality_flag,
    source_topic,
    source_partition,
    source_offset,
    batch_id,
    simulated_fault
from ranked
where row_num = 1
