import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ActivationStart, Router } from '@angular/router';
import { RaceDto } from '@punchcontrol/shared/race-dto';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Observable } from 'rxjs/Observable';
import { combineLatest } from 'rxjs/observable/combineLatest';
import { of } from 'rxjs/observable/of';
import { delay, distinctUntilChanged, filter, map, shareReplay, tap } from 'rxjs/operators';
import { LOGGING } from '../../util/logging';
import { WebSocketService } from './websocket.service';
import { WebSocketMessage } from '@punchcontrol/shared/websocket-dto';
import { PatchDto } from '@punchcontrol/shared/patching';

const LOGGER = LOGGING.getLogger('RacesService');

@Injectable()
export class RacesService {
    races: Observable<{ races: RaceDto[]; selectedRaceId: number; enabled: boolean }>;

    private _races = new BehaviorSubject<RaceDto[]>([]);
    private _selectedRaceId = new BehaviorSubject<number>(-1);
    private _racesTabsEnabled = new BehaviorSubject<boolean>(true);

    constructor(private router: Router, private http: HttpClient, private webSocketService: WebSocketService) {
        http.get<RaceDto[]>('/api/races').subscribe(rr => this._races.next(rr));

        router.events.subscribe(e => {
            if (e instanceof ActivationStart) {
                const raceId = e.snapshot.paramMap.get('race');
                this._racesTabsEnabled.next(!!raceId);
                if (raceId) { // some links have no race such as admin
                    const raceIdNum = parseInt(raceId, 10);
                    this._selectedRaceId.next(raceIdNum);
                }
            }
        });

        this.races = combineLatest(
            this._races,
            this._selectedRaceId.pipe(distinctUntilChanged()),
            this._racesTabsEnabled.pipe(distinctUntilChanged())
        ).pipe(
            tap(state => LOGGER.debug(`Races: ${JSON.stringify(state)}`)),
            // Transform to object
            map(([races, selectedRaceId, enabled]) => ({ races, selectedRaceId, enabled })),
            // reset to 1st race if selected race is no longer available
            map(state => {
                const ids = state.races.map(r => r.id);
                if (ids.length > 0 && !ids.includes(state.selectedRaceId)) {
                    state.selectedRaceId = -1;
                    this._selectedRaceId.next(ids[0]);
                }
                return state;
            }),
            // filter out meaningless states
            filter(state => state.selectedRaceId !== -1),
            // logging
            tap(state => LOGGER.debug(`Races: ${JSON.stringify(state)}`)),
            // any subscriber gets the latest and greatest state
            shareReplay(1)
        );

        this.races.pipe(
            map(state => {
                const race = state.races.filter(r => r.id === state.selectedRaceId);
                return race.length > 0 ? race[0].name : '';
            })
        ).subscribe(name => {
            document.title = !name ? `punchcontrol` : `${name} - punchcontrol`;
        });


        this.webSocketService.receive.subscribe((msg: WebSocketMessage) => {
            if (msg.path === '/api/races') {
                LOGGER.infoc(() => `Receiving websocket ${msg.path}`);
                this._races.next(msg.body);
            } else if (msg.path === '/api/generic/patch') {
                const patches: PatchDto[] = msg.body;
                for (const p of patches) {
                    if (p.patchEl === 'Race#raceId.name') {
                        const races = [...this._races.getValue()];
                        races.map(r => {
                            if (r.id === p.id) {
                                r.name = p.newVal;
                            }
                            return r;
                        });
                        this._races.next(races);
                    }
                }
            }
        });
    }


    upload(raceId: number, files: File[]): void {
        for (let i = 0; i < files.length; i++) {
            LOGGER.infoc(() => `Registration file ${i}: '${files[i].name}' (${files[i].size} bytes)`);
            this.http.post(`/api/races/${raceId}/registration`, files[i]).subscribe((r) => {
                LOGGER.infoc(() => `File '${files[i].name}' uploaded`);
            }, (err) => {
                LOGGER.error(`Could not upload '${files[i].name}' ${err}`);
            });
        }
    }

    uploadCourses(raceId: number, files: File[]): void {
        for (let i = 0; i < files.length; i++) {
            LOGGER.infoc(() => `Courses file ${i}: '${files[i].name}' (${files[i].size} bytes)`);
            this.http.post(`/api/races/${raceId}/courses`, files[i]).subscribe((r) => {
                LOGGER.infoc(() => `File '${files[i].name}' uploaded`);
            }, (err) => {
                LOGGER.error(`Could not upload '${files[i].name}' ${err}`);
            });
        }
    }

    createRace(): void {
        this.http.post<RaceDto>(`/api/races`, {
            'name': '...',
            'form': 'FIXME',
            'startMode': 'FIXME'
        }).subscribe(r => {
            // const race: RaceDto = {id: r.id, name: r.name, startMode: r.startMode, form: r.form};
            // const races = [...this._races.getValue(), r];
            LOGGER.debug(`Race created`);
            // this._races.next(races);
        });
    }
    deleteRaces(ids: string[]): void {
        ids.forEach(id => {
            this.http.delete<void>(`/api/races/${id}`).subscribe(() => LOGGER.info(`Deleted race ${id}`));
        });
    }
    generateFfcoClasses(raceId: number): void {
        this.http.post(`/api/races/${raceId}/classes/generate`, {}).subscribe((r) => {
            LOGGER.infoc(() => `Generated`);
        }, (err) => {
            LOGGER.error(`Could not generate classes' ${err}`);
        });
    }
}
