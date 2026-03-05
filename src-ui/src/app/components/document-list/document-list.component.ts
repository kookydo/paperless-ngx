import { AsyncPipe, NgClass, NgTemplateOutlet } from '@angular/common'
import {
  Component,
  inject,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core'
import { FormsModule, ReactiveFormsModule } from '@angular/forms'
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
  RouterModule,
} from '@angular/router'
import {
  NgbDropdownModule,
  NgbModal,
  NgbPaginationModule,
} from '@ng-bootstrap/ng-bootstrap'
import { NgxBootstrapIconsModule } from 'ngx-bootstrap-icons'
import { TourNgBootstrap } from 'ngx-ui-tour-ng-bootstrap'
import { filter, first, map, Subject, switchMap, takeUntil } from 'rxjs'
import {
  DEFAULT_DISPLAY_FIELDS,
  DisplayField,
  DisplayMode,
  Document,
  DocumentGroupBy,
} from 'src/app/data/document'
import { FilterRule } from 'src/app/data/filter-rule'
import { FILTER_FULLTEXT_MORELIKE } from 'src/app/data/filter-rule-type'
import { SavedView } from 'src/app/data/saved-view'
import { SETTINGS_KEYS } from 'src/app/data/ui-settings'
import { IfPermissionsDirective } from 'src/app/directives/if-permissions.directive'
import {
  SortableDirective,
  SortEvent,
} from 'src/app/directives/sortable.directive'
import { CorrespondentNamePipe } from 'src/app/pipes/correspondent-name.pipe'
import { CustomDatePipe } from 'src/app/pipes/custom-date.pipe'
import { DocumentTitlePipe } from 'src/app/pipes/document-title.pipe'
import { DocumentTypeNamePipe } from 'src/app/pipes/document-type-name.pipe'
import { StoragePathNamePipe } from 'src/app/pipes/storage-path-name.pipe'
import { UsernamePipe } from 'src/app/pipes/username.pipe'
import { DocumentListViewService } from 'src/app/services/document-list-view.service'
import { HotKeyService } from 'src/app/services/hot-key.service'
import { OpenDocumentsService } from 'src/app/services/open-documents.service'
import {
  PermissionAction,
  PermissionsService,
} from 'src/app/services/permissions.service'
import { SavedViewService } from 'src/app/services/rest/saved-view.service'
import { SettingsService } from 'src/app/services/settings.service'
import { ToastService } from 'src/app/services/toast.service'
import { WebsocketStatusService } from 'src/app/services/websocket-status.service'
import {
  filterRulesDiffer,
  isFullTextFilterRule,
} from 'src/app/utils/filter-rules'
import { ClearableBadgeComponent } from '../common/clearable-badge/clearable-badge.component'
import { CustomFieldDisplayComponent } from '../common/custom-field-display/custom-field-display.component'
import { PageHeaderComponent } from '../common/page-header/page-header.component'
import { PreviewPopupComponent } from '../common/preview-popup/preview-popup.component'
import { TagComponent } from '../common/tag/tag.component'
import { ComponentWithPermissions } from '../with-permissions/with-permissions.component'
import { BulkEditorComponent } from './bulk-editor/bulk-editor.component'
import { DocumentCardLargeComponent } from './document-card-large/document-card-large.component'
import { DocumentCardSmallComponent } from './document-card-small/document-card-small.component'
import { FilterEditorComponent } from './filter-editor/filter-editor.component'
import { SaveViewConfigDialogComponent } from './save-view-config-dialog/save-view-config-dialog.component'

interface DocumentGroup {
  key: string
  label: string
  documents: Document[]
  entityId?: number
}

interface FolderTreeNode {
  key: string
  label: string
  depth: number
  children: Map<string, FolderTreeNode>
  documents: Document[]
}

type FolderTableRow =
  | {
      type: 'node'
      key: string
      label: string
      depth: number
      count: number
    }
  | {
      type: 'document'
      key: string
      depth: number
      document: Document
    }

@Component({
  selector: 'pngx-document-list',
  templateUrl: './document-list.component.html',
  styleUrls: ['./document-list.component.scss'],
  imports: [
    ClearableBadgeComponent,
    CustomFieldDisplayComponent,
    PageHeaderComponent,
    BulkEditorComponent,
    FilterEditorComponent,
    DocumentCardSmallComponent,
    DocumentCardLargeComponent,
    PreviewPopupComponent,
    TagComponent,
    CustomDatePipe,
    DocumentTitlePipe,
    IfPermissionsDirective,
    SortableDirective,
    UsernamePipe,
    CorrespondentNamePipe,
    DocumentTypeNamePipe,
    StoragePathNamePipe,
    NgxBootstrapIconsModule,
    AsyncPipe,
    FormsModule,
    ReactiveFormsModule,
    NgTemplateOutlet,
    NgbDropdownModule,
    NgbPaginationModule,
    NgClass,
    RouterModule,
    TourNgBootstrap,
  ],
})
export class DocumentListComponent
  extends ComponentWithPermissions
  implements OnInit, OnDestroy
{
  list = inject(DocumentListViewService)
  savedViewService = inject(SavedViewService)
  route = inject(ActivatedRoute)
  private router = inject(Router)
  private toastService = inject(ToastService)
  private modalService = inject(NgbModal)
  private websocketStatusService = inject(WebsocketStatusService)
  openDocumentsService = inject(OpenDocumentsService)
  settingsService = inject(SettingsService)
  private hotKeyService = inject(HotKeyService)
  permissionService = inject(PermissionsService)

  DisplayField = DisplayField
  DisplayMode = DisplayMode

  groupByOptions: { id: DocumentGroupBy; name: string }[] = [
    { id: 'none', name: $localize`None` },
    { id: 'storagePath', name: $localize`Storage path` },
    { id: 'correspondent', name: $localize`Correspondent` },
    { id: 'documentType', name: $localize`Document type` },
    { id: 'createdYear', name: $localize`Created year` },
    { id: 'createdMonth', name: $localize`Created month` },
  ]

  @ViewChild('filterEditor')
  private filterEditor: FilterEditorComponent

  @ViewChildren(SortableDirective) headers: QueryList<SortableDirective>

  get activeDisplayFields(): DisplayField[] {
    return this.list.displayFields
  }

  set activeDisplayFields(fields: DisplayField[]) {
    this.list.displayFields = fields
    this.updateDisplayCustomFields()
  }

  get groupBy(): DocumentGroupBy {
    return this.list.groupBy
  }

  set groupBy(groupBy: DocumentGroupBy) {
    this.list.groupBy = groupBy
  }
  activeDisplayCustomFields: Set<string> = new Set()
  collapsedGroups: Set<string> = new Set()
  initializedGroupStates: Set<string> = new Set()

  public updateDisplayCustomFields() {
    this.activeDisplayCustomFields = new Set(
      Array.from(this.activeDisplayFields).filter(
        (field) =>
          typeof field === 'string' &&
          field.startsWith(DisplayField.CUSTOM_FIELD)
      )
    )
  }

  unmodifiedFilterRules: FilterRule[] = []
  private unmodifiedSavedView: SavedView
  private activeSavedView: SavedView | null = null

  private unsubscribeNotifier: Subject<any> = new Subject()

  get savedViewIsModified(): boolean {
    if (
      !this.list.activeSavedViewId ||
      !this.unmodifiedSavedView ||
      !this.activeSavedViewCanChange
    ) {
      return false
    } else {
      return (
        this.unmodifiedSavedView.sort_field !== this.list.sortField ||
        this.unmodifiedSavedView.sort_reverse !== this.list.sortReverse ||
        (this.unmodifiedSavedView.page_size &&
          this.unmodifiedSavedView.page_size !== this.list.pageSize) ||
        (this.unmodifiedSavedView.display_mode &&
          this.unmodifiedSavedView.display_mode !==
            this.getPersistableDisplayMode()) ||
        // if the saved view has no display mode, we assume it's small cards
        (!this.unmodifiedSavedView.display_mode &&
          this.getPersistableDisplayMode() !== DisplayMode.SMALL_CARDS) ||
        (this.unmodifiedSavedView.display_fields &&
          this.unmodifiedSavedView.display_fields.join(',') !==
            this.activeDisplayFields.join(',')) ||
        (!this.unmodifiedSavedView.display_fields &&
          this.activeDisplayFields.join(',') !==
            DEFAULT_DISPLAY_FIELDS.filter((f) => f.id !== DisplayField.ADDED)
              .map((f) => f.id)
              .join(',')) ||
        (this.unmodifiedSavedView.group_by ?? 'none') !== this.groupBy ||
        filterRulesDiffer(
          this.unmodifiedSavedView.filter_rules,
          this.list.filterRules
        )
      )
    }
  }

  get activeSavedViewCanChange(): boolean {
    if (!this.activeSavedView) {
      return false
    }
    return this.permissionService.currentUserHasObjectPermissions(
      PermissionAction.Change,
      this.activeSavedView
    )
  }

  get isFiltered() {
    return !!this.filterEditor?.rulesModified
  }

  getTitle() {
    let title = this.list.activeSavedViewTitle
    if (title && this.savedViewIsModified) {
      title += '*'
    } else if (!title) {
      title = $localize`Documents`
    }
    return title
  }

  getSortFields() {
    return isFullTextFilterRule(this.list.filterRules)
      ? this.list.sortFieldsFullText
      : this.list.sortFields
  }

  set listSortReverse(reverse: boolean) {
    this.list.sortReverse = reverse
  }

  get listSortReverse(): boolean {
    return this.list.sortReverse
  }

  onSort(event: SortEvent) {
    this.list.setSort(event.column, event.reverse)
  }

  onFilterRulesChange(filterRules: FilterRule[]) {
    this.list.setFilterRules(filterRules)
  }

  onFilterRulesReset(filterRules: FilterRule[]) {
    this.list.setFilterRules(filterRules, true)
  }

  get isBulkEditing(): boolean {
    return this.list.selected.size > 0
  }

  get isGroupingEnabled(): boolean {
    return this.groupBy !== 'none'
  }

  get groupedDocuments(): DocumentGroup[] {
    if (!this.isGroupingEnabled) {
      return []
    }
    if (!this.list.documents?.length) {
      return []
    }

    const groups = new Map<string, DocumentGroup>()

    for (const document of this.list.documents) {
      let key = ''
      let label = ''
      let entityId: number | undefined

      switch (this.groupBy) {
        case 'storagePath': {
          const resolvedPath = this.getArchivedFolderPath(document)
          if (document.storage_path) {
            key = resolvedPath || '__root'
            label = resolvedPath || $localize`No storage path`
          } else {
            key = '__none'
            label = $localize`No storage path`
          }
          break
        }
        case 'correspondent': {
          entityId = document.correspondent
          key = entityId?.toString() ?? '__none'
          label = entityId ? `#${entityId}` : $localize`No correspondent`
          break
        }
        case 'documentType': {
          entityId = document.document_type
          key = entityId?.toString() ?? '__none'
          label = entityId ? `#${entityId}` : $localize`No document type`
          break
        }
        case 'createdYear': {
          const created = this.parseDate(document.created)
          key = created ? created.getUTCFullYear().toString() : '__none'
          label = created ? key : $localize`No date`
          break
        }
        case 'createdMonth': {
          const created = this.parseDate(document.created)
          if (created) {
            const month = (created.getUTCMonth() + 1)
              .toString()
              .padStart(2, '0')
            key = `${created.getUTCFullYear()}-${month}`
            label = key
          } else {
            key = '__none'
            label = $localize`No date`
          }
          break
        }
        default: {
          key = this.getArchivedFolderPath(document)
          label = key || $localize`Root`
          break
        }
      }

      if (!groups.has(key)) {
        groups.set(key, { key, label, documents: [], entityId })
      }
      groups.get(key)!.documents.push(document)
    }

    const groupedDocuments = Array.from(groups.values())
    const activeGroupStateKeys = new Set(
      groupedDocuments.map((group) => this.getGroupStateKey(group.key))
    )
    this.applyGroupStateDefaults(activeGroupStateKeys)
    return groupedDocuments
  }

  get isHierarchicalStoragePathGrouping(): boolean {
    return this.isGroupingEnabled && this.groupBy === 'storagePath'
  }

  get folderRows(): FolderTableRow[] {
    if (!this.isGroupingEnabled) {
      return []
    }
    if (!this.list.documents?.length) {
      return []
    }

    const root: FolderTreeNode = {
      key: '__root__',
      label: '',
      depth: -1,
      children: new Map<string, FolderTreeNode>(),
      documents: [],
    }

    for (const document of this.list.documents) {
      if (this.groupBy === 'storagePath' && !document.storage_path) {
        this.addDocumentToTree(root, ['No storage path'], document, true)
        continue
      }

      const folderPath = this.getArchivedFolderPath(document)
      const segments = folderPath
        ? folderPath.split('/').filter(Boolean)
        : ['Root']
      this.addDocumentToTree(root, segments, document, false)
    }

    const rows: FolderTableRow[] = []
    const activeGroupStateKeys = new Set<string>()
    this.flattenFolderTree(root, rows, activeGroupStateKeys)
    this.applyGroupStateDefaults(activeGroupStateKeys)
    return rows
  }

  private getGroupStateKey(groupKey: string): string {
    return `${this.groupBy}:${groupKey}`
  }

  toggleGroup(groupKey: string) {
    const stateKey = this.getGroupStateKey(groupKey)
    if (this.collapsedGroups.has(stateKey)) {
      this.collapsedGroups.delete(stateKey)
    } else {
      this.collapsedGroups.add(stateKey)
    }
  }

  isGroupCollapsed(groupKey: string): boolean {
    return this.collapsedGroups.has(this.getGroupStateKey(groupKey))
  }

  collapseAllGroups() {
    const groupKeys = this.isHierarchicalStoragePathGrouping
      ? this.folderRows
          .filter((row) => row.type === 'node')
          .map((row) => row.key)
      : this.groupedDocuments.map((group) => group.key)
    this.collapsedGroups = new Set(
      groupKeys.map((groupKey) => this.getGroupStateKey(groupKey))
    )
  }

  expandAllGroups() {
    this.collapsedGroups.clear()
  }

  getDocumentFromFolderRow(row: FolderTableRow): Document | null {
    return row.type === 'document' ? row.document : null
  }

  get folderGroupHeaderColspan(): number {
    let count = 1 // selection checkbox
    if (this.activeDisplayFields.includes(DisplayField.ASN)) {
      count++
    }
    if (
      this.activeDisplayFields.includes(DisplayField.CORRESPONDENT) &&
      this.permissionService.currentUserCan(
        this.PermissionAction.View,
        this.PermissionType.Correspondent
      )
    ) {
      count++
    }
    if (
      this.activeDisplayFields.includes(DisplayField.TITLE) ||
      this.activeDisplayFields.includes(DisplayField.TAGS)
    ) {
      count++
    }
    if (
      this.activeDisplayFields.includes(DisplayField.OWNER) &&
      this.permissionService.currentUserCan(
        this.PermissionAction.View,
        this.PermissionType.User
      )
    ) {
      count++
    }
    if (
      this.activeDisplayFields.includes(DisplayField.NOTES) &&
      this.notesEnabled
    ) {
      count++
    }
    if (
      this.activeDisplayFields.includes(DisplayField.DOCUMENT_TYPE) &&
      this.permissionService.currentUserCan(
        this.PermissionAction.View,
        this.PermissionType.DocumentType
      )
    ) {
      count++
    }
    if (
      this.activeDisplayFields.includes(DisplayField.STORAGE_PATH) &&
      this.permissionService.currentUserCan(
        this.PermissionAction.View,
        this.PermissionType.StoragePath
      )
    ) {
      count++
    }
    if (this.activeDisplayFields.includes(DisplayField.CREATED)) {
      count++
    }
    if (this.activeDisplayFields.includes(DisplayField.ADDED)) {
      count++
    }
    if (this.activeDisplayFields.includes(DisplayField.PAGE_COUNT)) {
      count++
    }
    if (this.activeDisplayFields.includes(DisplayField.SHARED)) {
      count++
    }
    count += this.activeDisplayCustomFields.size
    return count
  }

  onGroupByChange(groupBy: DocumentGroupBy) {
    this.groupBy = groupBy
    this.collapsedGroups.clear()
    this.initializedGroupStates.clear()
  }

  private addDocumentToTree(
    root: FolderTreeNode,
    segments: string[],
    document: Document,
    noStoragePath: boolean
  ) {
    let current = root
    let currentKey = ''
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const segmentLabel = this.getPathSegmentLabel(segment)
      currentKey = noStoragePath
        ? '__none'
        : segment === 'Root'
          ? '__root'
          : currentKey
            ? `${currentKey}/${segment}`
            : segment
      if (!current.children.has(segmentLabel)) {
        current.children.set(segmentLabel, {
          key: currentKey,
          label: segmentLabel,
          depth: i,
          children: new Map<string, FolderTreeNode>(),
          documents: [],
        })
      }
      current = current.children.get(segmentLabel)!
    }
    current.documents.push(document)
  }

  private flattenFolderTree(
    node: FolderTreeNode,
    rows: FolderTableRow[],
    activeGroupStateKeys: Set<string>
  ) {
    const children = Array.from(node.children.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true })
    )

    for (const child of children) {
      const count = this.getTreeDocumentCount(child)
      rows.push({
        type: 'node',
        key: child.key,
        label: child.label,
        depth: child.depth,
        count,
      })
      const stateKey = this.getGroupStateKey(child.key)
      activeGroupStateKeys.add(stateKey)
      if (this.isGroupCollapsed(child.key)) {
        continue
      }
      this.flattenFolderTree(child, rows, activeGroupStateKeys)
      child.documents.forEach((document) =>
        rows.push({
          type: 'document',
          key: `${child.key}:${document.id}`,
          depth: child.depth + 1,
          document,
        })
      )
    }
  }

  private getTreeDocumentCount(node: FolderTreeNode): number {
    let count = node.documents.length
    node.children.forEach((child) => {
      count += this.getTreeDocumentCount(child)
    })
    return count
  }

  private getPathSegmentLabel(segment: string): string {
    if (segment?.toLowerCase() === 'none') {
      return $localize`No value`
    }
    return segment
  }

  private applyGroupStateDefaults(activeGroupStateKeys: Set<string>) {
    this.initializedGroupStates = new Set(
      Array.from(this.initializedGroupStates).filter((key) =>
        activeGroupStateKeys.has(key)
      )
    )
    this.collapsedGroups = new Set(
      Array.from(this.collapsedGroups).filter((key) =>
        activeGroupStateKeys.has(key)
      )
    )

    activeGroupStateKeys.forEach((stateKey) => {
      if (!this.initializedGroupStates.has(stateKey)) {
        // Default: newly seen groups start collapsed.
        this.collapsedGroups.add(stateKey)
        this.initializedGroupStates.add(stateKey)
      }
    })
  }

  private parseDate(value?: Date | string | null): Date | null {
    if (!value) return null
    const parsed = value instanceof Date ? value : new Date(value)
    return isNaN(parsed.getTime()) ? null : parsed
  }

  private getArchivedFolderPath(document: Document): string {
    const archivedPath = (
      document.archived_file_path ?? document.archived_file_name
    )?.replace(/\\/g, '/')
    if (!archivedPath || !archivedPath.includes('/')) {
      return ''
    }
    return archivedPath.substring(0, archivedPath.lastIndexOf('/'))
  }

  private getPersistableDisplayMode(): DisplayMode {
    return this.list.displayMode
  }

  toggleDisplayField(field: DisplayField) {
    if (this.activeDisplayFields.includes(field)) {
      this.activeDisplayFields = this.activeDisplayFields.filter(
        (f) => f !== field
      )
    } else {
      this.activeDisplayFields = [...this.activeDisplayFields, field]
    }
    this.updateDisplayCustomFields()
  }

  public getDisplayCustomFieldTitle(field: string) {
    return this.settingsService.allDisplayFields.find((f) => f.id === field)
      ?.name
  }

  ngOnInit(): void {
    this.websocketStatusService
      .onDocumentConsumptionFinished()
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        this.list.reload()
      })

    this.websocketStatusService.onDocumentDeleted().subscribe(() => {
      this.list.reload()
    })

    this.route.paramMap
      .pipe(
        filter((params) => params.has('id')), // only on saved view e.g. /view/id
        switchMap((params) => {
          return this.savedViewService
            .getCached(+params.get('id'))
            .pipe(map((view) => ({ view })))
        })
      )
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(({ view }) => {
        if (!view) {
          this.activeSavedView = null
          this.router.navigate(['404'], {
            replaceUrl: true,
          })
          return
        }
        this.activeSavedView = view
        this.unmodifiedSavedView = view
        this.list.activateSavedViewWithQueryParams(
          view,
          convertToParamMap(this.route.snapshot.queryParams)
        )
        this.list.reload(() => {
          this.savedViewService.setDocumentCount(view, this.list.collectionSize)
        })
        this.updateDisplayCustomFields()
        this.unmodifiedFilterRules = view.filter_rules
      })

    this.route.queryParamMap
      .pipe(
        filter(() => !this.route.snapshot.paramMap.has('id')), // only when not on /view/id
        takeUntil(this.unsubscribeNotifier)
      )
      .subscribe((queryParams) => {
        this.updateDisplayCustomFields()
        if (queryParams.has('view')) {
          // loading a saved view on /documents
          this.loadViewConfig(parseInt(queryParams.get('view')))
        } else {
          this.activeSavedView = null
          this.list.activateSavedView(null)
          this.list.loadFromQueryParams(queryParams)
          this.unmodifiedFilterRules = []
        }
      })

    this.hotKeyService
      .addShortcut({
        keys: 'escape',
        description: $localize`Reset filters / selection`,
      })
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        if (this.list.selected.size > 0) {
          this.list.selectNone()
        } else if (this.isFiltered) {
          this.resetFilters()
        }
      })

    this.hotKeyService
      .addShortcut({ keys: 'a', description: $localize`Select all` })
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        this.list.selectAll()
      })

    this.hotKeyService
      .addShortcut({ keys: 'p', description: $localize`Select page` })
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        this.list.selectPage()
      })

    this.hotKeyService
      .addShortcut({
        keys: 'o',
        description: $localize`Open first [selected] document`,
      })
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        if (this.list.documents.length > 0) {
          if (this.list.selected.size > 0) {
            this.openDocumentDetail(Array.from(this.list.selected)[0])
          } else {
            this.openDocumentDetail(this.list.documents[0])
          }
        }
      })

    this.hotKeyService
      .addShortcut({
        keys: 'control.arrowleft',
        description: $localize`Previous page`,
      })
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        if (this.list.currentPage > 1) {
          this.list.currentPage--
        }
      })

    this.hotKeyService
      .addShortcut({
        keys: 'control.arrowright',
        description: $localize`Next page`,
      })
      .pipe(takeUntil(this.unsubscribeNotifier))
      .subscribe(() => {
        if (this.list.currentPage < this.list.getLastPage()) {
          this.list.currentPage++
        }
      })
  }

  ngOnDestroy() {
    this.list.cancelPending()
    this.unsubscribeNotifier.next(this)
    this.unsubscribeNotifier.complete()
  }

  saveViewConfig() {
    if (this.list.activeSavedViewId != null && this.activeSavedViewCanChange) {
      let savedView: SavedView = {
        id: this.list.activeSavedViewId,
        filter_rules: this.list.filterRules,
        sort_field: this.list.sortField,
        sort_reverse: this.list.sortReverse,
        display_mode: this.getPersistableDisplayMode(),
        display_fields: this.activeDisplayFields,
        group_by: this.groupBy,
      }
      this.savedViewService
        .patch(savedView)
        .pipe(first())
        .subscribe({
          next: (view) => {
            this.activeSavedView = view
            this.unmodifiedSavedView = view
            this.toastService.showInfo(
              $localize`View "${this.list.activeSavedViewTitle}" saved successfully.`
            )
            this.unmodifiedFilterRules = this.list.filterRules
          },
          error: (err) => {
            this.toastService.showError(
              $localize`Failed to save view "${this.list.activeSavedViewTitle}".`,
              err
            )
          },
        })
    }
  }

  loadViewConfig(viewID: number) {
    this.savedViewService
      .getCached(viewID)
      .pipe(first())
      .subscribe((view) => {
        if (!view) {
          this.activeSavedView = null
          return
        }
        this.activeSavedView = view
        this.unmodifiedSavedView = view
        this.list.activateSavedView(view)
        this.list.reload(() => {
          this.savedViewService.setDocumentCount(view, this.list.collectionSize)
        })
      })
  }

  saveViewConfigAs() {
    let modal = this.modalService.open(SaveViewConfigDialogComponent, {
      backdrop: 'static',
    })
    modal.componentInstance.defaultName = this.filterEditor.generateFilterName()
    modal.componentInstance.saveClicked.pipe(first()).subscribe((formValue) => {
      modal.componentInstance.buttonsEnabled = false
      let savedView: SavedView = {
        name: formValue.name,
        filter_rules: this.list.filterRules,
        sort_reverse: this.list.sortReverse,
        sort_field: this.list.sortField,
        display_mode: this.getPersistableDisplayMode(),
        display_fields: this.activeDisplayFields,
        group_by: this.groupBy,
      }
      const permissions = formValue.permissions_form
      if (permissions) {
        if (permissions.owner !== null && permissions.owner !== undefined) {
          savedView.owner = permissions.owner
        }
        if (permissions.set_permissions) {
          savedView['set_permissions'] = permissions.set_permissions
        }
      }

      this.savedViewService
        .create(savedView)
        .pipe(first())
        .subscribe({
          next: (createdView) => {
            this.saveCreatedViewVisibility(
              createdView,
              formValue.showOnDashboard,
              formValue.showInSideBar
            )
              .pipe(first())
              .subscribe({
                next: () => {
                  modal.close()
                  this.toastService.showInfo(
                    $localize`View "${savedView.name}" created successfully.`
                  )
                },
                error: (error) => {
                  modal.close()
                  this.toastService.showError(
                    $localize`View "${savedView.name}" created successfully, but could not update visibility settings.`,
                    error
                  )
                },
              })
          },
          error: (httpError) => {
            let error = httpError.error
            if (error.filter_rules) {
              error.filter_rules = error.filter_rules.map((r) => r.value)
            }
            modal.componentInstance.error = error
            modal.componentInstance.buttonsEnabled = true
          },
        })
    })
  }

  private saveCreatedViewVisibility(
    createdView: SavedView,
    showOnDashboard: boolean,
    showInSideBar: boolean
  ) {
    const dashboardViewIds = this.savedViewService.dashboardViews.map(
      (v) => v.id
    )
    const sidebarViewIds = this.savedViewService.sidebarViews.map((v) => v.id)
    if (showOnDashboard) {
      dashboardViewIds.push(createdView.id)
    }
    if (showInSideBar) {
      sidebarViewIds.push(createdView.id)
    }

    return this.settingsService.updateSavedViewsVisibility(
      dashboardViewIds,
      sidebarViewIds
    )
  }

  openDocumentDetail(document: Document | number) {
    this.router.navigate([
      'documents',
      typeof document === 'number' ? document : document.id,
    ])
  }

  toggleSelected(document: Document, event: MouseEvent): void {
    if (!event.shiftKey) this.list.toggleSelected(document)
    else this.list.selectRangeTo(document)
  }

  clickTag(tagID: number) {
    this.list.selectNone()
    this.filterEditor.toggleTag(tagID)
  }

  clickCorrespondent(correspondentID: number) {
    this.list.selectNone()
    this.filterEditor.toggleCorrespondent(correspondentID)
  }

  clickDocumentType(documentTypeID: number) {
    this.list.selectNone()
    this.filterEditor.toggleDocumentType(documentTypeID)
  }

  clickStoragePath(storagePathID: number) {
    this.list.selectNone()
    this.filterEditor.toggleStoragePath(storagePathID)
  }

  clickMoreLike(documentID: number) {
    this.list.quickFilter([
      { rule_type: FILTER_FULLTEXT_MORELIKE, value: documentID.toString() },
    ])
  }

  get notesEnabled(): boolean {
    return this.settingsService.get(SETTINGS_KEYS.NOTES_ENABLED)
  }

  resetFilters() {
    this.filterEditor.resetSelected()
  }
}
