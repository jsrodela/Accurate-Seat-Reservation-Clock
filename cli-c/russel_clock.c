#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <math.h>
#include <curl/curl.h>

typedef struct {
  int ok;
  long long t0_ms, t3_ms;
  double rtt_ms;
  long long server_date_ms;
  double offset_ms;
  char date_header[128];
} sample_t;

#define MAX_SAMPLES 240
static sample_t SAMPLES[MAX_SAMPLES];
static int SCOUNT = 0;

static long long now_ms(){
  struct timespec ts;
#if defined(_WIN32)
  timespec_get(&ts, TIME_UTC);
#else
  clock_gettime(CLOCK_REALTIME, &ts);
#endif
  return (long long)ts.tv_sec*1000LL + ts.tv_nsec/1000000LL;
}

static size_t header_cb(char *buffer, size_t size, size_t nitems, void *userdata){
  size_t total = size*nitems;
  if (total>6 && strncasecmp(buffer,"Date:",5)==0){
    size_t len = total<127 ? total : 127;
    memcpy(((sample_t*)userdata)->date_header, buffer+6, len-6);
    ((sample_t*)userdata)->date_header[len-6] = '\0';
    char *p = ((sample_t*)userdata)->date_header;
    for(size_t i=0;i<len;i++){
      if(p[i]=='\r'||p[i]=='\n'){ p[i]='\0'; break; }
    }
  }
  return total;
}

static int head_once(const char* url, sample_t* out){
  memset(out,0,sizeof(*out));
  out->ok = 0;
  out->t0_ms = now_ms();

  CURL *curl = curl_easy_init();
  if(!curl) return 0;
  curl_easy_setopt(curl, CURLOPT_URL, url);
  curl_easy_setopt(curl, CURLOPT_NOBODY, 1L);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 2000L);
  curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, header_cb);
  curl_easy_setopt(curl, CURLOPT_HEADERDATA, out);

  CURLcode res = curl_easy_perform(curl);
  out->t3_ms = now_ms();

  out->rtt_ms = (double)(out->t3_ms - out->t0_ms);
  if(res==CURLE_OK && out->date_header[0]){
    struct tm tm={0};
    if (strptime(out->date_header, " %a, %d %b %Y %H:%M:%S GMT", &tm)){
      time_t t = timegm(&tm);
      out->server_date_ms = (long long)t*1000LL;
      long long midpoint = (out->t0_ms + out->t3_ms)/2LL;
      out->offset_ms = (double)out->server_date_ms - (double)midpoint;
      out->ok = 1;
    }
  }
  curl_easy_cleanup(curl);
  return out->ok;
}

static void push_sample(sample_t s){
  if(SCOUNT<MAX_SAMPLES){ SAMPLES[SCOUNT++]=s; }
  else{
    memmove(SAMPLES, SAMPLES+1, sizeof(sample_t)*(MAX_SAMPLES-1));
    SAMPLES[MAX_SAMPLES-1]=s;
  }
}

static int cmp_rtt(const void* a, const void* b){
  double ra=((sample_t*)a)->rtt_ms;
  double rb=((sample_t*)b)->rtt_ms;
  return (ra<rb)?-1:(ra>rb)?1:0;
}

static double mean(double *a, int n){ double s=0; for(int i=0;i<n;i++) s+=a[i]; return s/n; }
static double pstdev(double *a, int n){ if(n<=1) return 0.0; double m=mean(a,n); double s=0; for(int i=0;i<n;i++){ double d=a[i]-m; s+=d*d; } return sqrt(s/n); }

typedef struct {
  int have;
  long long now_local_ms, now_server_ms;
  double offset_ms, offset_median_ms, offset_stdev_ms;
  double rtt_ms, rtt_stdev_ms, best_rtt_ms;
  int count;
} stats_t;

static stats_t get_stats(){
  stats_t st; memset(&st,0,sizeof(st));
  long long nowL = now_ms();
  st.now_local_ms = nowL;

  sample_t ok[MAX_SAMPLES]; int n=0;
  for(int i=0;i<SCOUNT;i++) if(SAMPLES[i].ok) ok[n++]=SAMPLES[i];
  if(!n){ st.have=0; return st; }

  qsort(ok,n,sizeof(sample_t),cmp_rtt);
  sample_t best = ok[0];
  double *offs = (double*)malloc(sizeof(double)*n);
  double *rtts = (double*)malloc(sizeof(double)*n);
  for(int i=0;i<n;i++){ offs[i]=ok[i].offset_ms; rtts[i]=ok[i].rtt_ms; }

  double *offs_sorted = (double*)malloc(sizeof(double)*n);
  memcpy(offs_sorted, offs, sizeof(double)*n);
  for(int i=1;i<n;i++){ double key=offs_sorted[i]; int j=i-1; while(j>=0 && offs_sorted[j]>key){ offs_sorted[j+1]=offs_sorted[j]; j--; } offs_sorted[j+1]=key; }
  double median = (n%2)? offs_sorted[n/2] : (offs_sorted[n/2-1]+offs_sorted[n/2])/2.0;

  st.have=1;
  st.offset_ms = best.offset_ms;
  st.best_rtt_ms = best.rtt_ms;
  st.rtt_ms = mean(rtts,n);
  st.rtt_stdev_ms = pstdev(rtts,n);
  st.offset_median_ms = median;
  st.offset_stdev_ms = pstdev(offs,n);
  st.count = n;
  st.now_server_ms = nowL + (long long)(st.offset_ms);

  free(offs_sorted); free(offs); free(rtts);
  return st;
}

static long long parse_local_iso_ms(const char* s){
  struct tm tm={0};
  if(!strptime(s, "%Y-%m-%d %H:%M:%S", &tm)) return -1;
  time_t t = mktime(&tm);
  return (t<0)?-1: (long long)t*1000LL;
}

static void fmt_time(long long ms, char* out, int cap){
  if(ms<=0){ snprintf(out,cap,"--:--:--.---"); return; }
  time_t sec = (time_t)(ms/1000LL);
  struct tm *lt = localtime(&sec);
  int hh=lt->tm_hour, mm=lt->tm_min, ss=lt->tm_sec;
  int ms3 = (int)(ms%1000LL); if(ms3<0) ms3=0;
  snprintf(out,cap,"%02d:%02d:%02d.%03d",hh,mm,ss,ms3);
}
static void fmt_dur(long long ms, char* out, int cap){
  int neg = (ms<0); if(neg) ms=-ms;
  long long s = ms/1000LL; long long m = s/60LL; long long rs = s%60LL; int ms3=(int)(ms%1000LL);
  snprintf(out,cap,"%s%02lld:%02lld.%03d", neg?"-":"", m, rs, ms3);
}

int main(int argc, char** argv){
  const char* url    = (argc>1)? argv[1] : "https://myrussel.megastudy.net/reserve/reserve_list.asp";
  const char* mode   = (argc>2)? argv[2] : "local";
  const char* target = (argc>3)? argv[3] : "";
  int prefire = (argc>4)? atoi(argv[4]) : 120;
  int halfrtt = (argc>5)? atoi(argv[5]) : 1;

  curl_global_init(CURL_GLOBAL_DEFAULT);
  printf("[Russel Clock C] polling: %s\n", url); fflush(stdout);

  for(;;){
    sample_t s; head_once(url, &s);
    push_sample(s);

    stats_t st = get_stats();

    long long target_server = -1;
    if(target && target[0]){
      long long local_ms = parse_local_iso_ms(target);
      if(local_ms>0){
        if(strcmp(mode,"local")==0){
          target_server = local_ms + (long long)(st.offset_ms);
        } else {
          target_server = local_ms;
        }
      }
    }

    long long click_local=-1, eta=-1;
    if(target_server>0 && st.have){
      double travel = (halfrtt && st.best_rtt_ms>0)? st.best_rtt_ms/2.0 : 0.0;
      click_local = target_server - (long long)(st.offset_ms) - prefire - (long long)travel;
      eta = click_local - st.now_local_ms;
    }

    char tloc[32], tsv[32], tclick[32], tdur[32];
    fmt_time(st.now_local_ms, tloc, sizeof tloc);
    fmt_time(st.now_server_ms, tsv, sizeof tsv);
    fmt_time(click_local, tclick, sizeof tclick);
    fmt_dur(eta, tdur, sizeof tdur);

    printf("\rlocal=%s  server=%s  offset=%s%0.0fms  rtt=%s%0.0f/%0.0fms  click=%s  ETA=%s   ",
      tloc, tsv,
      (st.have && !isnan(st.offset_ms))?"":"--", st.offset_ms,
      (st.have && !isnan(st.rtt_ms))?"":"--", st.rtt_ms, st.best_rtt_ms,
      (click_local>0)?tclick:"—",
      (eta>=0 || eta<0)? tdur:"—"
    );
    fflush(stdout);
#if defined(_WIN32)
    Sleep(1000);
#else
    struct timespec ts={1,0}; nanosleep(&ts,NULL);
#endif
  }
  curl_global_cleanup();
  return 0;
}
