export interface FunnelMetrics {
  sqls: number;
  sqos: number;
  joined: number;
  pipelineAum: number;
  joinedAum: number;
  openPipelineAum: number;
}

export interface ConversionRates {
  contactedToMql: { rate: number; numerator: number; denominator: number };
  mqlToSql: { rate: number; numerator: number; denominator: number };
  sqlToSqo: { rate: number; numerator: number; denominator: number };
  sqoToJoined: { rate: number; numerator: number; denominator: number };
}

export interface SourcePerformance {
  source: string;
  channel: string;
  prospects: number;
  contacted: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  aum: number;
}

export interface ChannelPerformance {
  channel: string;
  prospects: number;
  contacted: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  aum: number;
}

export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string; // The relevant date field based on metric filter (Date_Became_SQO__c, converted_date_raw, advisor_join_date__c, etc.)
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
}

export interface ForecastData {
  monthKey: string;
  channel: string;
  metric: string;
  stage: string;
  originalSource: string;
  forecastValue: number;
}

export interface TrendDataPoint {
  period: string;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
}
