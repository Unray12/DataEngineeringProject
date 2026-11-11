{{ config(
    materialized='incremental',
    file_format='iceberg',
    incremental_strategy='merge',
    on_schema_change='append_new_columns',
    unique_key=['field_id', 'metric', 'hour_start'],
    partition_by=['day']
) }}

-- Hourly aggregates per field and metric over the readings that passed validation (FR5.1).
-- Each hour carries the crop's target range so daily indicators (time in range, hours below
-- target) can be derived without joining the reference data again (FR5.2, FR5.3).
select
    s.field_id,
    s.farm_id,
    s.crop_code,
    s.metric,
    date_trunc('hour', s.measured_at) as hour_start,
    cast(date_trunc('day', s.measured_at) as date) as day,
    t.target_min,
    t.target_max,
    min(s.value) as min_value,
    max(s.value) as max_value,
    avg(s.value) as avg_value,
    count(*) as reading_count,
    sum(case when t.target_min is not null then 1 else 0 end) as targeted_count,
    sum(case when s.value between t.target_min and t.target_max then 1 else 0 end) as in_range_count
from {{ ref('sensor_readings') }} s
left join {{ source('ops', 'crop_targets') }} t
    on t.crop_code = s.crop_code
   and t.metric = s.metric
where s.value is not null
  and s.quality_flag = 'ok'
  {% if is_incremental() %}
  and cast(s.measured_at as date) >= date_sub(current_date(), {{ var('gold_lookback_days') }})
  {% endif %}
group by 1, 2, 3, 4, 5, 6, 7, 8
