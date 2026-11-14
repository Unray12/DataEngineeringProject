{{ config(
    materialized='incremental',
    file_format='iceberg',
    incremental_strategy='merge',
    on_schema_change='append_new_columns',
    unique_key=['field_id', 'metric', 'day'],
    partition_by=['day']
) }}

-- Daily management indicators (percentages divide doubles; decimal division would round them):
--   time_in_range_pct  share of readings inside the crop's target range (null without a target)
--   hours_below_target hours in which the average soil moisture was under the target minimum
with hourly as (
    select
        field_id,
        metric,
        day,
        sum(in_range_count) as in_range_count,
        sum(targeted_count) as targeted_count,
        count(distinct case
            when metric = 'soil_moisture' and target_min is not null and avg_value < target_min
            then hour_start
        end) as hours_below_target
    from {{ ref('field_hourly') }}
    group by 1, 2, 3
)
select
    d.field_id,
    d.farm_id,
    d.metric,
    d.day,
    d.min_value,
    d.max_value,
    d.avg_value,
    d.reading_count,
    d.valid_count,
    d.flagged_count,
    cast(d.valid_count as double) * 100 / nullif(d.reading_count, 0) as data_quality_pct,
    cast(d.flagged_count as double) * 100 / nullif(d.reading_count, 0) as flagged_pct,
    cast(h.in_range_count as double) * 100 / nullif(h.targeted_count, 0) as time_in_range_pct,
    cast(coalesce(h.hours_below_target, 0) as int) as hours_below_target
from {{ ref('field_daily') }} d
left join hourly h
    on h.field_id = d.field_id and h.metric = d.metric and h.day = d.day
{% if is_incremental() %}
where d.day >= date_sub(current_date(), {{ var('gold_lookback_days') }})
{% endif %}
