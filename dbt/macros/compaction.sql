{% macro rewrite_data_files(table) %}
  {% set target = table if table.startswith('lakehouse.') else 'lakehouse.' ~ table %}
  {% set statement %}
    CALL lakehouse.system.rewrite_data_files(
      table => '{{ target }}',
      strategy => 'binpack'
    )
  {% endset %}
  {% do run_query(statement) %}
  {{ log('Compacted ' ~ target, info=True) }}
{% endmacro %}
