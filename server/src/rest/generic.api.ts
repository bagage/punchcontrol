import { ApiError, RestApiStatusCodes } from '@punchcontrol/shared/api';
import { PATCH_EL_RE, QUERY_EL_RE } from '@punchcontrol/shared/patching';
import { PatchDto } from '@punchcontrol/shared/patching';
import { CellType, ColumnDefinition, TableData } from '@punchcontrol/shared/table-data';
import { Service } from 'typedi';
import { Connection, SelectQueryBuilder } from 'typeorm';
import { DeepPartial } from 'typeorm/common/DeepPartial';
import { DatabaseController } from '../db/database.controller';
import { TeamMember } from '../entities/team_member';
import { LOGGING } from '../util/logging';
import { ExpressController } from '../startup/express.controller';
import { WebSocketController } from '../startup/websocket.controller';
import { Application } from 'express';

const LOGGER = LOGGING.getLogger(__filename);

interface QueryColumn {
    entity: string;
    field: string;
    relation?: string;
    id: string;
    isRelation: boolean
}

@Service()
export class GenericApi {

    constructor(
        private databaseCtrl: DatabaseController,
        private webSocketCtrl: WebSocketController) { }

    registerHandlers(app: Application): void {
        app.patch('/api/generic/patch', async (req, res) => {
            try {
                const patches: PatchDto[] = req.body;
                const err = await this.databaseCtrl.connection.transaction(async em => {
                    for (const p of patches) {
                        const match = p.patchEl.match(PATCH_EL_RE.re);
                        if (!match) {
                            LOGGER.info(`Patch EL error ${p.patchEl} - ignoring`);
                        } else {
                            const entity = PATCH_EL_RE.getField(match, 'entity');
                            const field = PATCH_EL_RE.getField(match, 'field');
                            const repo = em.getRepository(entity);
                            const dbEntity: any = await repo.findOneOrFail(p.id);
                            if (dbEntity[field] !== p.oldVal) {
                                const message = `Concurrent modification for ${entity}#${p.id}: expecting ${p.oldVal} found ${dbEntity[field]}`
                                LOGGER.error(message);
                                const err: ApiError = { code: 'ConcurrentModification', short: `Concurrent modification`, detail: message };
                                LOGGER.error(err.detail);
                                return err;
                            }
                            const part: DeepPartial<any> = {};
                            part[field] = p.newVal as any;
                            const ret = await repo.update(p.id, part);
                            LOGGER.info(`Patch returned ${JSON.stringify(ret)}`);
                        }
                    }
                    return null; // no error
                });
                if (err) {
                    res.status(RestApiStatusCodes.CLIENT_409_CONFLICT).send(err);
                } else {
                    this.webSocketCtrl.broadcast({ path: '/api/generic/patch', body: patches })
                    res.status(RestApiStatusCodes.SUCCESS_204_NO_CONTENT).send();
                }
            } catch (e) {
                const err: ApiError = { code: 'DatabaseError', short: `Could not save change`, detail: `${e}` };
                LOGGER.error(err.short);
                res.status(RestApiStatusCodes.SERVER_500_INTERNAL_SERVER_ERROR).send(e);
            }
        });
    }


    async queryForColumns(connection: Connection, columns: ColumnDefinition[], queryModifier: ((q: SelectQueryBuilder<{}>) => void)): Promise<TableData> {
        // the hidden columns should only be displayed at the end!
        columns = [
            ...columns.filter(col => !col.hidden),
            ...columns.filter(col => col.hidden)
        ]
        const parsedCols = columns.map(col => {
            const match = col.el.match(QUERY_EL_RE.re);
            if (match) {
                const entity = QUERY_EL_RE.getField(match, 'entity');
                const relation = QUERY_EL_RE.getField(match, 'relation');
                const field = QUERY_EL_RE.getField(match, 'field');
                const ret: QueryColumn = { entity, relation, field, id: col.id, isRelation: QUERY_EL_RE.has(match, 'relation') };
                return ret;
            }
        }).filter(col => !!col) as QueryColumn[];

        const entities = [...new Set(parsedCols.map(cols => cols.entity))];
        if (entities.length > 1) {
            LOGGER.error(`Mismatch in entity types in column definitions: found ${entities}`)
        }
        const joins = [...new Set(parsedCols.filter(col => col.isRelation).map(cols => cols.field))];

        const builder = connection.createQueryBuilder(entities[0], 'entity');
        joins.forEach(j => builder.leftJoin(`entity.${j}`, j));
        parsedCols.forEach(col => {
            if (col.isRelation) {
                builder.addSelect(`${col.relation}`, col.id);
            } else {
                builder.addSelect(`entity.${col.field}`, col.id);
            }
        });
        queryModifier(builder);
        const result = await builder.getRawMany();
        const data: TableData = { columns: columns, rows: result.map(line => columns.map(col => line[col.id])) }
        return data;
    }

    getColumns(root: QueryRoot) {
        return ALL_COLUMNS.get(root) || [];
    }
}

export type QueryRoot = 'TeamMember' | 'Races' | 'Runners' | 'Courses'; // add more when other roots are created

const ALL_COLUMNS: Map<QueryRoot, ColumnDefinition[]> = new Map();
ALL_COLUMNS.set('TeamMember', [
    {
        header: 'Team bib',
        id: 'bib',
        el: 'TeamMember.team>team.bib',
        patchEl: 'Team#teamId.bib',
    },
    {
        header: 'Runner sub-bib',
        id: 'bibSubnum',
        el: 'TeamMember.bibSubnum',
        readonly: true
    },
    {
        header: 'Team name',
        id: 'teamName',
        el: 'TeamMember.team>team.name',
        patchEl: 'Team#teamId.name'
    },
    {
        header: 'Race id',
        id: 'raceId',
        el: 'TeamMember.team>team.race_id',
        readonly: true,
        hidden: true
    },
    {
        header: 'First name',
        id: 'firstName',
        el: 'TeamMember.person>person.firstName',
        patchEl: 'Person#personId.firstName',
    },
    {
        header: 'Last name',
        id: 'lastName',
        el: 'TeamMember.person>person.lastName',
        patchEl: 'Person#personId.lastName',
    },
    {
        id: 'personId',
        el: 'TeamMember.person>person.id',
        readonly: true,
        hidden: true
    },
    {
        header: 'Sex',
        id: 'sex',
        el: 'TeamMember.person>person.sex',
        patchEl: 'Person#personId.sex',
    },
    {
        header: 'E-card',
        id: 'ecard',
        el: 'TeamMember.person>person.ecard',
        patchEl: 'Person#personId.ecard',
        cellType: CellType.INTEGER
    },
    {
        header: 'External key',
        id: 'externalKey',
        el: 'TeamMember.person>person.externalKey',
        patchEl: 'Person#personId.externalKey',
        readonly: true,
        cellType: CellType.INTEGER
    },
    {
        id: 'teamId',
        el: 'TeamMember.team>team.id',
        readonly: true,
        hidden: true
    }
]);
ALL_COLUMNS.set('Races', [
    {
        header: 'Race name',
        id: 'name',
        el: 'Race.name',
        patchEl: 'Race#raceId.name',
    },
    {
        header: 'Race form',
        id: 'form',
        el: 'Race.form',
        patchEl: 'Race#raceId.form',
    },
    {
        header: 'Start mode',
        id: 'startMode',
        el: 'Race.startMode',
        patchEl: 'Race#raceId.startMode',
    },
    {
        id: 'raceId',
        el: 'Race.id',
        readonly: true,
        hidden: true
    }
]);

ALL_COLUMNS.set('Courses', [
    {
        header: 'Course name',
        id: 'name',
        el: 'CourseFamily.name',
        // patchEl: 'CourseFamily#raceId.name',
    },
    {
        id: 'raceId',
        el: 'CourseFamily.race>race.id',
        readonly: true,
        hidden: true
    }
]);

ALL_COLUMNS.set('Runners', [
    {
        header: 'First name',
        id: 'firstName',
        el: 'IndividualRegistration.person>person.firstName',
        patchEl: 'Person#personId.firstName',
    },
    {
        header: 'Last name',
        id: 'lastName',
        el: 'IndividualRegistration.person>person.lastName',
        patchEl: 'Person#personId.lastName',
    },
    {
        id: 'personId',
        el: 'IndividualRegistration.person>person.id',
        readonly: true,
        hidden: true
    },
    {
        header: 'Sex',
        id: 'sex',
        el: 'IndividualRegistration.person>person.sex',
        patchEl: 'Person#personId.sex',
    },
    {
        header: 'E-card',
        id: 'ecard',
        el: 'IndividualRegistration.person>person.ecard',
        patchEl: 'Person#personId.ecard',
        cellType: CellType.INTEGER
    },
    {
        header: 'Class',
        id: 'class',
        el: 'IndividualRegistration.individualClass>individualClass.shortName',
    },
    {
        header: 'Course',
        id: 'course',
        el: 'IndividualRegistration.courseFamily>courseFamily.name',
    },
    {
        header: 'Race id',
        id: 'raceId',
        el: 'IndividualRegistration.individualClass>individualClass.race_id',
        readonly: true,
        hidden: true
    },
    {
        header: 'External key',
        id: 'externalKey',
        el: 'IndividualRegistration.person>person.externalKey',
        patchEl: 'Person#personId.externalKey',
        readonly: true,
        cellType: CellType.INTEGER
    },]);
