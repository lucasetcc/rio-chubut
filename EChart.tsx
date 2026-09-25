/** ECharts modular: sólo los tipos que usa la app (reduce el tamaño del bundle). */
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { AxisPointerComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, MarkLineComponent, AxisPointerComponent, CanvasRenderer]);

export default function EChart(props: any) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}
