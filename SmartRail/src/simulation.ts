export type Severity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL' | 'EMERGENCY';
export type SensorKey = 'smoke' | 'temperature' | 'humidity' | 'vibration' | 'heat';
export type Event = { id:number; timestamp:number; sensor:string; value:string; severity:Severity; message:string; location:string; action:string };
export type Sample = { time:number; temperature:number; humidity:number; smoke:number; vibration:number; heat:number; distance:number|null; speed:number };
export type Incident = { timestamp:number; cause:string; speed:number; distance:number|null; temperature:number; smoke:number; humidity:number; vibration:number; heat:number; latitude:number; longitude:number };
export type State = {
  running:boolean; moving:boolean; emergency:boolean; auto:boolean; demo:boolean; demoTime:number; demoStep:string;
  elapsed:number; position:number; speed:number; obstacle:number|null; distance:number|null; trainStatus:string; systemStatus:string;
  smoke:number; temperature:number; humidity:number; vibration:number; heat:number; motion:boolean;
  gps:boolean; gpsMove:boolean; latitude:number; longitude:number; satellites:number; esp:boolean; wifi:boolean;
  packetsSent:number; packetsReceived:number; uptime:number; lastData:number|null; signal:number;
  events:Event[]; history:Sample[]; incident:Incident|null; buzzer:boolean;
};
const initial = ():State => ({ running:false,moving:false,emergency:false,auto:true,demo:false,demoTime:0,demoStep:'Ready for departure',elapsed:0,position:25,speed:0,obstacle:null,distance:null,trainStatus:'STOPPED',systemStatus:'SAFE',smoke:32,temperature:28,humidity:48,vibration:12,heat:30,motion:false,gps:true,gpsMove:true,latitude:17.4435,longitude:78.3772,satellites:9,esp:true,wifi:true,packetsSent:0,packetsReceived:0,uptime:0,lastData:null,signal:-54,events:[],history:[],incident:null,buzzer:false });
export function obstacleStatus(distance:number|null) { return distance===null || distance>50 ? 'SAFE' : distance>=20 ? 'WARNING' : distance>10 ? 'DANGER' : distance===10 ? 'CRITICAL' : 'EMERGENCY'; }
export function sensorStatus(key:SensorKey,value:number) {
  if(key==='temperature') return value>60?'CRITICAL':value>=40?'WARNING':'NORMAL';
  if(key==='smoke') return value>=250?'CRITICAL':value>=100?'WARNING':'NORMAL';
  if(key==='humidity') return value>85?'HIGH':value>70||value<30?'WARNING':'NORMAL';
  if(key==='vibration') return value>=90?'EMERGENCY':value>=65?'TRACK ANOMALY':value>=35?'WARNING':'SAFE';
  return value>=80?'FIRE RISK':value>=60?'HIGH HEAT':value>=40?'WARNING':'NORMAL';
}
export class SimulationService {
  private state:State=initial(); private listeners=new Set<()=>void>(); private transitions:Record<string,string>={}; private nextId=1; private sampleClock=0; private transportClock=0; private demoPlaced=false;
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>this.listeners.delete(listener);};
  private publish(){this.state={...this.state}; this.listeners.forEach(l=>l());}
  private log(sensor:string,value:string,severity:Severity,message:string,action='Monitor'){const s=this.state;s.events=[{id:this.nextId++,timestamp:Date.now(),sensor,value,severity,message,location:`Track 01 · ${(s.position/100).toFixed(2)} km`,action},...s.events].slice(0,500);}
  private transition(sensor:string,status:string,value:string,message:string,severity:Severity){const previous=this.transitions[sensor]; if(status===previous)return;this.transitions[sensor]=status;if(status!=='NORMAL'&&status!=='SAFE'){this.log(sensor,value,severity,message);}else if(previous && previous!=='NORMAL' && previous!=='SAFE'){this.log(sensor,value,'INFO',`${sensor} returned to safe range`);}}
  private brake(cause:string){const s=this.state;if(s.emergency)return;s.incident={timestamp:Date.now(),cause,speed:s.speed,distance:s.distance,temperature:s.temperature,smoke:s.smoke,humidity:s.humidity,vibration:s.vibration,heat:s.heat,latitude:s.latitude,longitude:s.longitude};s.emergency=true;s.moving=false;s.speed=0;s.buzzer=true;s.demoStep='Incident contained · train safely stopped';this.log('Train',s.distance===null?'0 km/h':`${s.distance.toFixed(1)} cm`,'EMERGENCY',`Emergency braking activated: ${cause}`,'Emergency brake');}
  private evaluate(){const s=this.state;s.distance=s.obstacle===null?null:Math.max(0,s.obstacle-s.position);const obstacle=obstacleStatus(s.distance);this.transition('Ultrasonic',obstacle,s.distance===null?'Clear':`${s.distance.toFixed(1)} cm`,s.distance===null?'Track clear':`Obstacle detected ${s.distance.toFixed(1)} cm ahead`,obstacle==='WARNING'?'WARNING':obstacle==='DANGER'?'HIGH':obstacle==='EMERGENCY'?'EMERGENCY':'CRITICAL');
    const labels:Record<SensorKey,string>={smoke:'Smoke',temperature:'Temperature',humidity:'Humidity',vibration:'Vibration',heat:'Heat'};
    for(const key of Object.keys(labels) as SensorKey[]){const status=sensorStatus(key,s[key]);const severity:Severity=status==='WARNING'?'WARNING':status==='HIGH'||status==='HIGH HEAT'||status==='TRACK ANOMALY'?'HIGH':status==='EMERGENCY'?'EMERGENCY':'CRITICAL';const msg=key==='smoke'&&status==='CRITICAL'?'SMOKE/FIRE DETECTED':key==='temperature'&&status==='CRITICAL'?'HIGH TEMPERATURE: exceeded 60°C':key==='heat'&&status==='FIRE RISK'?'FIRE RISK: high heat detected':`${labels[key]}: ${status.toLowerCase()}`;this.transition(labels[key],status,`${s[key].toFixed(1)} ${key==='smoke'?'ppm':key==='humidity'?'%':key==='vibration'?'%':'°C'}`,msg,severity);}
    this.transition('Motion',s.motion?'WARNING':'SAFE',s.motion?'Detected':'Clear','Unexpected movement detected near Track 01','WARNING');
    this.transition('GPS',s.gps?'SAFE':'WARNING',s.gps?'9 satellites':'No signal','GPS signal lost','WARNING');
    this.transition('ESP32',s.esp&&s.wifi?'SAFE':'CRITICAL','Disconnected',s.esp?'ESP32 Wi-Fi communication failure':'ESP32 communication failure','CRITICAL');
    if(s.distance!==null&&s.distance<10)this.brake('Obstacle within 10 cm');if(s.vibration>=90)this.brake('Critical track vibration');
    const high=[s.temperature>60,s.smoke>=250,s.heat>=80,!s.esp||!s.wifi].some(Boolean);
    const warning=[s.temperature>=40,s.smoke>=100,s.heat>=40,s.humidity>70,s.humidity<30,s.vibration>=35,s.motion,!s.gps,s.distance!==null&&s.distance<=50].some(Boolean);
    s.systemStatus=s.emergency?'EMERGENCY':high?'CRITICAL':warning?'WARNING':'SAFE';s.trainStatus=s.emergency?'EMERGENCY':!s.moving?'STOPPED':!s.running?'PAUSED':obstacle==='SAFE'?'RUNNING':obstacle;
  }
  action(name:string){const s=this.state;
    if(name==='reset'){this.state=initial();this.transitions={};this.sampleClock=0;this.transportClock=0;this.demoPlaced=false;this.log('System','Reset','INFO','Simulation reset','Ready');this.evaluate();this.publish();return;}
    if(name==='demo'){this.action('reset');const n=this.state;n.running=true;n.demo=true;n.esp=false;n.wifi=false;n.demoStep='Connecting virtual ESP32';this.evaluate();this.publish();return;}
    if(name==='startSimulation'){s.running=true;this.log('System','Running','INFO','Simulation started');}
    if(name==='pause'){s.running=false;this.log('System','Paused','INFO','Simulation paused','Pause clock');}
    if(name==='resume'||name==='startTrain'){
      if((s.distance!==null&&s.distance<10)||s.vibration>=90){this.log('Train','Interlock','WARNING','Clear the obstacle and critical vibration before resuming','Start blocked');this.publish();return;}
      s.emergency=false;s.buzzer=false;s.running=true;s.moving=true;s.demo=false;this.log('Train','60 km/h target','INFO','Train departure authorized','Start train');
    }
    if(name==='stopTrain'){s.moving=false;s.speed=0;s.demo=false;this.log('Train','0 km/h','INFO','Train stopped by operator','Stop train');}
    if(name==='emergencyStop'){this.brake('Operator emergency stop');s.demo=false;}
    if(name==='placeObstacle'){s.obstacle=s.position+100;this.log('Ultrasonic','100 cm','INFO','Obstacle placed ahead of train','Obstacle placed');}
    if(name==='removeObstacle'){s.obstacle=null;this.log('Ultrasonic','Clear','INFO','Obstacle removed; resume when ready','Clear track');}
    if(name==='clearEvents')s.events=[];
    if(name==='dismissIncident')s.incident=null;
    this.evaluate();this.publish();
  }
  setSensor(key:SensorKey,value:number){if(!Number.isFinite(value))throw new Error('Sensor value must be finite');const ranges:Record<SensorKey,[number,number]>={smoke:[0,500],temperature:[0,100],humidity:[0,100],vibration:[0,100],heat:[0,120]};if(!(key in ranges)||value<ranges[key][0]||value>ranges[key][1])throw new Error('Sensor value outside supported range');this.state.auto=false;this.state.demo=false;this.state[key]=value;this.evaluate();this.publish();}
  toggle(key:'auto'|'motion'|'gps'|'gpsMove'|'esp'|'wifi',value:boolean){this.state[key]=value;if(key==='auto')this.state.demo=false;this.evaluate();this.publish();}
  tick(dt:number){const s=this.state;if(!s.running)return;dt=Math.min(Math.max(dt,0),.25);s.elapsed+=dt;if(s.esp&&s.wifi)s.uptime+=dt;
    if(s.demo){s.demoTime+=dt;const t=s.demoTime;if(t>=1&&!s.esp){s.esp=true;s.wifi=true;this.log('ESP32','Connected','INFO','ESP32 online; eight sensor modules active','Begin telemetry');}if(t>=2&&!s.moving&&!s.emergency){s.moving=true;s.demoStep='Train departed · live telemetry streaming';}if(t>=5&&!this.demoPlaced){s.obstacle=s.position+100;this.demoPlaced=true;s.demoStep='Obstacle detected · approaching Track 01';this.log('Ultrasonic','100 cm','INFO','Demo obstacle placed','Track monitoring');}if(t>=9&&!s.emergency){s.demoStep=s.emergency?s.demoStep:'Environmental sensors rising · safety response active';s.temperature=Math.min(67,28+(t-9)*3);s.smoke=Math.min(320,32+(t-9)*16);s.heat=Math.min(90,30+(t-9)*4.5);s.vibration=Math.min(78,12+(t-9)*4);s.humidity=Math.min(89,48+(t-9)*2);s.motion=t>12;}}
    else if(s.auto&&s.esp&&s.wifi){const t=s.elapsed; s.temperature=28+3*Math.sin(t/12);s.humidity=48+8*Math.sin(t/17);s.smoke=32+15*Math.sin(t/9);s.vibration=12+7*Math.sin(t/4);s.heat=30+4*Math.sin(t/13);}
    this.evaluate();if(s.moving&&!s.emergency){const d=s.distance;const target=d===null||d>50?60:d>=20?Math.max(16,d*.64):8;s.speed+=(target-s.speed)*Math.min(1,dt*2.5);s.position+=s.speed*.18*dt;if(s.obstacle===null&&s.position>390)s.position=25;if(s.gps&&s.gpsMove){s.latitude=17.4435+s.position*.00001;s.longitude=78.3772+s.position*.000022;}}
    this.evaluate();this.transportClock+=dt;this.sampleClock+=dt;
    if(this.transportClock>=.25&&s.esp&&s.wifi){this.transportClock=0;s.packetsSent++;s.packetsReceived++;s.lastData=Date.now();s.signal=-54+Math.round(3*Math.sin(s.elapsed/10));}
    if(this.sampleClock>=1){this.sampleClock=0;s.history=[...s.history,{time:Math.round(s.elapsed),temperature:s.temperature,humidity:s.humidity,smoke:s.smoke,vibration:s.vibration,heat:s.heat,distance:s.distance,speed:s.speed}].slice(-90);}
    this.publish();
  }
  // In-process API adapter: virtual device → service → subscribed dashboard. No network or physical hardware required.
  async request(path:string,method='GET',body?:Partial<Record<SensorKey,number>>){const s=this.state;if(path==='/api/sensor-data'&&method==='POST'){if(!body)throw new Error('Sensor payload required');for(const [key,value] of Object.entries(body)){const max=key==='smoke'?500:key==='heat'?120:100;if(!['smoke','temperature','humidity','vibration','heat'].includes(key)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)throw new Error('Invalid sensor payload');}for(const [key,value] of Object.entries(body))this.setSensor(key as SensorKey,value as number);return {accepted:true,timestamp:Date.now()};}if(method!=='GET')throw new Error('Unsupported method');switch(path){case '/api/train-status':return {status:s.trainStatus,speed:s.speed,distance:s.distance};case '/api/sensors':return {smoke:s.smoke,temperature:s.temperature,humidity:s.humidity,vibration:s.vibration,heat:s.heat,motion:s.motion};case '/api/alerts':return s.events.filter(e=>e.severity!=='INFO');case '/api/events':return s.events;case '/api/gps':return {latitude:s.latitude,longitude:s.longitude,signal:s.gps};case '/api/system-status':return {status:s.systemStatus,esp32:s.esp,wifi:s.wifi};default:throw new Error('Unknown API route');}}
}
export const simulation=new SimulationService();
