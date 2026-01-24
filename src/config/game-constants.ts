export const GAME_CONFIG = {
  GAME_DURATION: 90, // 1 minute 30 seconds
  STARTING_LIVES: 3,
  EOQ_MODE_START: 80, // Last 10 seconds: "EOQ" mode (80-90 seconds)
  SPAWN_INTERVAL_NORMAL: 1400,
  SPAWN_INTERVAL_EOQ: 800,
  BASE_FALL_SPEED: 2.0,
  EOQ_FALL_SPEED_MULTIPLIER: 2.5, // Final speed for last 10 seconds
  JOINED_SPEED_MULTIPLIER: 2.5,
  GHOST_PENALTY: 5000000, // $5M
  POWERUP_SPAWN_CHANCE: 0.05,
  GHOST_SPAWN_CHANCE: 0.15,
  STOP_SIGN_SPAWN_CHANCE: 0.10,
  JOINED_SPAWN_CHANCE: 0.05,
  CANVAS_WIDTH: 700,
  CANVAS_HEIGHT: 500,
  PLAYER_WIDTH: 100,
  PLAYER_HEIGHT: 60,
  // Progressive speed stages
  SPEED_STAGE_1_TIME: 30, // 1.25X speed by 30 seconds
  SPEED_STAGE_2_TIME: 60, // 1.5X speed by 60 seconds
  SPEED_STAGE_3_TIME: 79, // 2X speed by 79 seconds
  SPEED_STAGE_1_MULTIPLIER: 1.25,
  SPEED_STAGE_2_MULTIPLIER: 1.5,
  SPEED_STAGE_3_MULTIPLIER: 2.0,
};

export const STAGE_SPEED_MODIFIERS: Record<string, number> = {
  'Qualifying': 1.4,
  'Discovery': 1.2,
  'Sales Process': 1.0,
  'Negotiating': 0.75,
};

export const getAumColor = (aum: number): string => {
  if (aum >= 50000000) return '#a855f7'; // Purple whale
  if (aum >= 25000000) return '#3b82f6'; // Blue premium
  if (aum >= 10000000) return '#22c55e'; // Green growth
  return '#6b7280'; // Gray starter
};

export const formatGameAum = (aum: number): string => {
  if (aum >= 1000000000) return `$${(aum / 1000000000).toFixed(2)}B`;
  if (aum >= 1000000) return `$${(aum / 1000000).toFixed(1)}M`;
  if (aum >= 1000) return `$${(aum / 1000).toFixed(0)}K`;
  return `$${aum}`;
};

export const QUARTERS_TO_SHOW = 5;

export const getQuarterDates = (quarter: string): { startDate: string; endDate: string } => {
  const [year, q] = quarter.split('-Q');
  const quarterNum = parseInt(q);
  const startMonth = (quarterNum - 1) * 3;
  const startDate = new Date(parseInt(year), startMonth, 1);
  
  const now = new Date();
  const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  
  let endDate: Date;
  if (quarter === currentQuarter) {
    // QTD: end date is today
    endDate = now;
  } else {
    // Past quarter: end date is last day of quarter
    endDate = new Date(parseInt(year), startMonth + 3, 0);
  }
  
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
};

export const getCurrentQuarter = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
};

export const getLastNQuarters = (n: number): string[] => {
  const quarters: string[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11
  const currentQuarter = Math.floor(currentMonth / 3) + 1; // 1-4
  
  // Start with current quarter (QTD)
  quarters.push(`${currentYear}-Q${currentQuarter}`);
  
  // Add previous quarters
  for (let i = 1; i < n; i++) {
    let year = currentYear;
    let q = currentQuarter - i;
    
    // Handle year rollover
    while (q <= 0) {
      q += 4;
      year -= 1;
    }
    
    quarters.push(`${year}-Q${q}`);
  }
  
  return quarters;
};

export const formatQuarterDisplay = (quarter: string): string => {
  const [year, q] = quarter.split('-');
  return `${q} ${year}`;
};

export const isQTD = (quarter: string): boolean => {
  return quarter === getCurrentQuarter();
};
