{{ config(materialized='table') }}

select
    field_id,
    farm_id,
    metric,
    cast(date_trunc('day', measured_at) as date) as day,
    min(value) as min_value,
    max(value) as max_value,
    avg(value) as avg_value,
    count(*) as reading_count,
    sum(case when quality_flag = 'ok' then 1 else 0 end) as valid_count,
    sum(case when quality_flag <> 'ok' then 1 else 0 end) as flagged_count
from {{ ref('sensor_readings') }}
where value is not null
group by 1, 2, 3, 4
